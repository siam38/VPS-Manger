#!/usr/bin/env node
/**
 * update-runner.mjs — applies a panel update.
 *
 * Runs DETACHED, from a copy of itself in a temp directory, because it
 * overwrites the very tree it would otherwise be executing from.
 *
 * Safety model, in order:
 *   1. Refuse on a dirty tree — never silently eat local edits.
 *   2. Full backup of the current install before anything is touched.
 *   3. Build the new version in a STAGING directory. The live panel is
 *      untouched during this phase, so a bad dependency or a broken build
 *      costs nothing.
 *   4. Boot the staged build on a scratch port and require a real HTTP answer
 *      from /api/version. A build that cannot serve is never promoted.
 *   5. Only then swap it into place and restart.
 *   6. If the restarted panel does not answer, restore the backup and restart
 *      again. Rollback is automatic, not a button someone has to find.
 *
 * Progress is written to a status file the panel polls, so the browser can
 * follow along across the restart that kills its own connection.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';

const [, , ROOT, TARGET_TAG, TARBALL_URL] = process.argv;

if (!ROOT || !TARGET_TAG || !TARBALL_URL) {
  console.error('usage: update-runner.mjs <root> <tag> <tarballUrl>');
  process.exit(2);
}

const PARENT = path.dirname(ROOT);
const NAME = path.basename(ROOT);
const STAGING = path.join(PARENT, `.${NAME}-staging`);
const BACKUP = path.join(PARENT, `.${NAME}-backup`);
const STATUS_FILE = path.join(ROOT, 'server', 'update-status.json');
const LOG_FILE = path.join(os.tmpdir(), 'vps-manager-update.log');
const PROBE_PORT = 48999;

/**
 * The port THIS install serves on.
 *
 * Deliberately read from the target's own .env rather than process.env: the
 * runner inherits the environment of whatever launched it, and trusting that
 * means health-checking a different panel than the one being updated — which
 * returns a pass from an unrelated process and defeats the rollback entirely.
 */
const PORT = (() => {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = /^\s*PORT\s*=\s*(\d+)/m.exec(raw);
    if (m) return Number(m[1]);
  } catch {}
  return Number(process.env.PANEL_PORT) || 48292;
})();

// Files that belong to THIS machine, not to the release. They survive the swap.
const PRESERVE = [
  '.env',
  'server/sessions.json',
  'server/update-config.json',
  'server/update-cache.json',
  'git-sync-config.json',
  'ecosystem.config.cjs',
];

const steps = [
  'check', 'backup', 'download', 'install', 'build', 'verify', 'swap', 'restart', 'done',
];

// Captured at load, before anything is written: the install's owner is who the
// status file must belong to, not whoever is running the update.
const STATUS_OWNER = (() => {
  try {
    const st = fs.statSync(ROOT);
    return (st.uid === 0 && st.gid === 0) ? null : { uid: st.uid, gid: st.gid };
  } catch { return null; }
})();

let state = {
  running: true,
  ok: null,
  step: 'check',
  steps,
  message: 'Starting…',
  fromVersion: null,
  toVersion: String(TARGET_TAG).replace(/^v/, ''),
  startedAt: Date.now(),
  finishedAt: null,
  rolledBack: false,
  error: null,
  log: [],
};

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  state.log.push(line);
  if (state.log.length > 200) state.log.shift();
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
  writeStatus();
}

function setStep(step, message) {
  state.step = step;
  state.message = message;
  log(`${step}: ${message}`);
}

function writeStatus() {
  try {
    const tmp = `${STATUS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATUS_FILE);
    // The runner is root; the panel that must later rewrite and delete this
    // file is not. Left root-owned, dismissing a finished run fails with
    // EACCES and the result banner cannot be cleared.
    if (STATUS_OWNER && typeof process.getuid === 'function' && process.getuid() === 0) {
      try { fs.chownSync(STATUS_FILE, STATUS_OWNER.uid, STATUS_OWNER.gid); } catch {}
    }
  } catch {}
}

function finish(ok, error, rolledBack = false) {
  state.running = false;
  state.ok = ok;
  state.error = error || null;
  state.rolledBack = rolledBack;
  state.finishedAt = Date.now();
  state.step = ok ? 'done' : state.step;
  state.message = ok
    ? `Updated to v${state.toVersion}`
    : rolledBack
      ? `Update failed and was rolled back: ${error}`
      : `Update failed: ${error}`;
  writeStatus();
  process.exit(ok ? 0 : 1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: opts.timeout ?? 600_000,
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) {
    const tail = String(r.stderr || r.stdout || '').trim().split('\n').slice(-6).join(' | ');
    throw new Error(`${cmd} ${args[0] ?? ''} failed: ${tail || `exit ${r.status}`}`);
  }
  return r.stdout;
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }

/**
 * Who owns this install.
 *
 * Captured BEFORE anything is written, because the runner usually executes as
 * root (the panel it restarts is a root process) while the checkout belongs to
 * a human account. Every file the update writes would otherwise land
 * root-owned, and every later edit — an editor save from the panel itself, a
 * git operation, the next npm install — fails with EACCES on a tree that looks
 * perfectly fine. Restoring ownership is not cosmetic; without it the update
 * succeeds and leaves the install unmaintainable.
 */
function ownerOf(dir) {
  try {
    const st = fs.statSync(dir);
    return { uid: st.uid, gid: st.gid };
  } catch { return null; }
}

/** Re-apply the captured ownership across the tree. No-op when we are not root
 *  or already own it — chown fails for an unprivileged caller. */
function restoreOwner(owner, dir) {
  if (!owner) return;
  if (typeof process.getuid === 'function' && process.getuid() !== 0) return;
  if (owner.uid === 0 && owner.gid === 0) return;
  const r = spawnSync('chown', ['-R', `${owner.uid}:${owner.gid}`, dir], {
    encoding: 'utf8', timeout: 120_000,
  });
  if (r.status === 0) log(`ownership restored to ${owner.uid}:${owner.gid}`);
  else log(`could not restore ownership: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'vps-manager-updater' }, timeout: 120_000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    }).on('timeout', function () { this.destroy(new Error('Download timed out')); })
      .on('error', reject);
  });
}

/**
 * Wait for a port to respond.
 *
 * `strict` demands a JSON body with a version field. That matters after the
 * restart, where a leftover process could answer and be mistaken for a healthy
 * update. It is deliberately NOT used for the staged probe: there we spawned
 * the process ourselves on a scratch port, so merely listening proves it boots,
 * and a release that predates the version endpoint must still be installable.
 */
function waitForHttp(port, timeoutMs = 60_000, strict = true) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(resolve => {
    const tick = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/version', timeout: 3000 },
        res => {
          let body = '';
          res.on('data', c => { body += c; });
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const parsed = JSON.parse(body);
                if (parsed && typeof parsed.version === 'string') return resolve(parsed);
              } catch {}
            }
            // Listening but without a usable version endpoint.
            if (!strict && res.statusCode > 0) return resolve({ version: null, legacy: true });
            retry();
          });
        }
      );
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 1500);
    };
    tick();
  });
}

/** How this host brings the panel back. Detected, never assumed — `pm2 startup`
 *  reporting success on a host where it does nothing is exactly this trap. */
function restartStrategy() {
  const pid1 = (() => {
    try { return fs.readFileSync('/proc/1/comm', 'utf8').trim(); } catch { return ''; }
  })();
  const has = bin => spawnSync('which', [bin], { encoding: 'utf8' }).status === 0;

  if (pid1 === 'systemd' && has('systemctl')) {
    const unit = ['vps-manager', 'vpsmanager', 'vps-panel'].find(u =>
      spawnSync('systemctl', ['cat', u], { encoding: 'utf8' }).status === 0
    );
    if (unit) return { kind: 'systemd', unit };
  }
  if (has('pm2')) {
    // Require PROOF that pm2 manages this install: a clean exit, parseable
    // JSON, and an entry whose script path lives inside ROOT.
    //
    // A substring match on raw output is not proof. pm2's own error text
    // ("Permission denied" on the rpc socket, common in containers) can
    // contain the install path, which previously selected the pm2 strategy
    // for a panel pm2 has never managed — the restart then failed and left
    // the panel down.
    const list = spawnSync('pm2', ['jlist'], { encoding: 'utf8' });
    if (list.status === 0) {
      try {
        const apps = JSON.parse(list.stdout || '[]');
        const mine = Array.isArray(apps) && apps.find(a => {
          const script = a?.pm2_env?.pm_exec_path || a?.pm2_env?.pm_cwd || '';
          return script && path.resolve(script).startsWith(path.resolve(ROOT));
        });
        if (mine?.name) return { kind: 'pm2', name: mine.name };
      } catch {}
    }
    log('pm2 present but does not manage this install; not using it to restart');
  }
  const script = path.join(ROOT, 'start-panel.sh');
  // A start script shipped in the release may hardcode the path of the machine
  // it was written on. Accept it only if it resolves its own directory or cds
  // to this install; a literal path belonging elsewhere would start the wrong
  // panel entirely.
  if (fs.existsSync(script)) {
    try {
      const body = fs.readFileSync(script, 'utf8');
      const cd = /^\s*cd\s+(.+)$/m.exec(body);
      const raw = cd ? cd[1].trim().replace(/\s*\|\|.*$/, '') : null;
      const dynamic = raw ? /\$\(|BASH_SOURCE|\$\{?0/.test(raw) : false;
      const target = raw ? raw.replace(/^["']|["']$/g, '') : null;
      if (!raw || dynamic || path.resolve(target) === path.resolve(ROOT)) {
        return { kind: 'script', script };
      }
      log(`ignoring start-panel.sh: it cds to ${target}, not ${ROOT}`);
    } catch {}
  }
  return { kind: 'node' };
}

/**
 * Stop the panel by whoever is holding the port.
 *
 * Matching the process by command line is unreliable: the panel is usually
 * started via a script that `cd`s first, so argv reads `server/index.cjs`
 * relative and an absolute-path match finds nothing. Failing to kill it then
 * turns the post-restart health check into a false positive, because the OLD
 * process answers and the update reports success. Port ownership is the fact
 * that actually matters here.
 */
async function stopPanel(hintPid = null, strategy = null) {
  // On systemd, stop the UNIT rather than the process.
  //
  // Killing the pid directly fights the supervisor: `Restart=on-failure`
  // brings a fresh copy straight back up on the old code, which then holds
  // the port while the swap is still in progress and answers the post-restart
  // health check as though the update had worked.
  if (strategy?.kind === 'systemd') {
    const r = spawnSync('systemctl', ['stop', strategy.unit], { encoding: 'utf8', timeout: 120_000 });
    log(`stop: systemctl stop ${strategy.unit} -> exit ${r.status}`);
    if (r.status === 0) return 1;
    // fall through to signalling if the unit refused to stop
  }

  const pids = new Set(listenersOn(PORT));

  // Ask the panel who it is.
  //
  // This is the only identification that works on a host where fuser/lsof/ss
  // are absent AND /proc/<pid>/fd is unreadable even to root (hardened
  // containers block the symlinks, so the inode->pid scan resolves nothing and
  // stopPanel silently kills no one). /api/version reports the serving
  // process's own pid, and it is port-specific by construction: whoever
  // answers on PORT is by definition the process to stop.
  //
  // Deliberately NOT a scan of process command lines. Two installs of this
  // panel on one box have identical argv, so a cmdline match would kill an
  // unrelated instance that happens to share the name.
  const self = await waitForHttp(PORT, 4000, false);
  if (self?.pid) pids.add(Number(self.pid));
  if (hintPid) pids.add(Number(hintPid));

  let signalled = 0;
  for (const pid of pids) {
    if (!pid || pid === process.pid) continue;
    try { process.kill(pid, 'SIGTERM'); signalled++; } catch {}
  }
  log(`stop: signalled ${signalled} process(es) on port ${PORT}`);
  return signalled;
}

/** PIDs listening on a TCP port, via whichever tool this host has. */
function listenersOn(port) {
  const tries = [
    ['sh', ['-c', `fuser -n tcp ${port} 2>/dev/null`]],
    ['sh', ['-c', `lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null`]],
    ['sh', ['-c', `ss -tlnpH 'sport = :${port}' 2>/dev/null | grep -oP 'pid=\\K[0-9]+'`]],
  ];
  for (const [cmd, args] of tries) {
    const out = spawnSync(cmd, args, { encoding: 'utf8' }).stdout || '';
    const pids = [...new Set(out.match(/\d+/g) || [])].map(Number).filter(Boolean);
    if (pids.length) return pids;
  }
  // Last resort: read /proc directly. Minimal containers ship none of the
  // tools above, and silently returning "nobody is listening" is the worst
  // possible answer here — it lets a stale process survive the swap and then
  // answer the health check in place of the new build.
  return listenersFromProc(port);
}

/** Resolve port -> inode from /proc/net/tcp*, then inode -> pid via /proc/<pid>/fd. */
function listenersFromProc(port) {
  const inodes = new Set();
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      const localPort = parseInt((cols[1] || '').split(':')[1], 16);
      if (localPort !== Number(port)) continue;
      if (cols[3] !== '0A') continue; // 0A = TCP_LISTEN
      inodes.add(cols[9]);
    }
  }
  if (!inodes.size) return [];

  const pids = [];
  let entries = [];
  try { entries = fs.readdirSync('/proc'); } catch { return []; }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${name}/fd`); } catch { continue; } // not ours
    for (const fd of fds) {
      let link;
      try { link = fs.readlinkSync(`/proc/${name}/fd/${fd}`); } catch { continue; }
      const m = /^socket:\[(\d+)\]$/.exec(link);
      if (m && inodes.has(m[1])) { pids.push(Number(name)); break; }
    }
  }
  return [...new Set(pids)];
}

/** Block until nothing is listening on the port, so the replacement cannot
 *  fail with EADDRINUSE and leave the stale process serving.
 *
 *  A process owned by another user is invisible in /proc to a non-root caller,
 *  so "no listeners found" is not proof the port is free. Confirm by actually
 *  trying to bind it. */
function waitForPortFree(port, timeoutMs = 20_000, extraPids = []) {
  const deadline = Date.now() + timeoutMs;
  const escalate = new Set(extraPids.filter(Boolean).map(Number));
  while (Date.now() < deadline) {
    const pids = listenersOn(port);
    for (const pid of [...pids, ...escalate]) {
      if (!pid || pid === process.pid) continue;
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    // canBind is the verdict, not the pid list. On hosts where fuser/lsof/ss
    // are missing and /proc fds are unreadable, listenersOn returns an empty
    // array whether the port is free or held — so requiring it to be empty
    // proves nothing, while a successful bind proves everything.
    if (canBind(port)) return true;
    spawnSync('sleep', ['1']);
  }
  return canBind(port);
}

/** Can we actually bind the port right now? The only trustworthy answer. */
function canBind(port) {
  const r = spawnSync(process.execPath, ['-e', `
    const net = require('net');
    const s = net.createServer();
    s.once('error', () => process.exit(1));
    s.listen({ port: ${port}, host: '::', ipv6Only: false }, () => s.close(() => process.exit(0)));
  `], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0;
}

/** Environment variables from an install's .env file. */
function envFrom(dir) {
  const out = {};
  try {
    const raw = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}

function startPanel(strategy) {
  // `start`, not `restart`: stopPanel has already stopped the unit, and
  // `restart` on a stopped unit that fails to start reports differently
  // across systemd versions. Starting an already-stopped unit is unambiguous.
  if (strategy.kind === 'systemd') { run('systemctl', ['start', strategy.unit], { timeout: 120_000 }); return; }
  if (strategy.kind === 'pm2') { run('pm2', ['restart', strategy.name], { timeout: 120_000 }); return; }

  const cmd = strategy.kind === 'script'
    ? ['sh', [strategy.script]]
    : ['node', [path.join(ROOT, 'server', 'index.cjs')]];

  // The start script sources .env itself. Passing an inherited PORT through
  // would override it and bind the wrong port. When starting node directly
  // there is no script to source it, so .env must be loaded here — the server
  // refuses to boot without PASSWORD/JWT_SECRET.
  const childEnv = { ...process.env };
  delete childEnv.PORT;
  if (strategy.kind === 'node') Object.assign(childEnv, envFrom(ROOT));

  // Detached and fully redirected: the child must outlive this process.
  // cwd is forced to ROOT because a start script may `cd` to a path that was
  // correct on the machine that authored it, not on this one.
  const child = spawn(cmd[0], cmd[1], {
    cwd: ROOT,
    detached: true,
    env: childEnv,
    stdio: ['ignore', fs.openSync(LOG_FILE, 'a'), fs.openSync(LOG_FILE, 'a')],
  });
  child.unref();
}

/**
 * Is the only change to package-lock.json its `version` field?
 *
 * Compares the diff hunks rather than parsing: anything beyond version lines
 * (a dependency added, a resolved URL changed) means real local work, which
 * the dirty-tree guard should still refuse.
 */
function lockfileVersionOnly() {
  const r = spawnSync('git', ['diff', '--unified=0', '--', 'package-lock.json'], {
    cwd: ROOT, encoding: 'utf8', timeout: 30_000,
  });
  if (r.status !== 0) return false;
  const changed = String(r.stdout || '')
    .split('\n')
    .filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  if (!changed.length) return false;
  return changed.every(l => /^[+-]\s*"version":\s*"[^"]*",?\s*$/.test(l));
}

async function main() {
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });

    // ── 1. preflight ──
    setStep('check', 'Checking working tree');
    try {
      state.fromVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    } catch {}

    if (fs.existsSync(path.join(ROOT, '.git'))) {
      const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout || '';
      // The runner writes its own status file inside the tree, so it must not
      // count itself as a local modification.
      const OWN = ['server/update-status.json', 'server/update-status.json.tmp'];
      const real = dirty.trim().split('\n').filter(Boolean).filter(line => {
        const file = line.slice(3).trim().replace(/^"|"$/g, '');
        if (OWN.includes(file)) return false;
        // npm rewrites package-lock.json's version field to match
        // package.json on every install. If the two were ever committed out
        // of sync, a plain `npm install` — step 2 of the documented install —
        // dirties the tree by itself, and this guard then blocks every future
        // update on a working install the operator never touched. A
        // version-only drift in the lockfile is npm's bookkeeping, not local
        // work worth protecting, so it is not a reason to refuse.
        if (file === 'package-lock.json' && lockfileVersionOnly()) return false;
        return true;
      });
      if (real.length) {
        return finish(false, `Working tree has ${real.length} uncommitted change(s). Commit or discard them first.`);
      }
    }

    const strategy = restartStrategy();
    log(`restart strategy: ${strategy.kind}${strategy.unit ? ` (${strategy.unit})` : ''}`);

    const owner = ownerOf(ROOT);
    if (owner) log(`install owned by ${owner.uid}:${owner.gid}`);

    // ── 2. backup ──
    setStep('backup', 'Backing up current installation');
    rmrf(BACKUP);
    fs.mkdirSync(BACKUP, { recursive: true });
    run('sh', ['-c',
      `cd ${JSON.stringify(ROOT)} && tar --exclude=node_modules --exclude=.git -cf - . | (cd ${JSON.stringify(BACKUP)} && tar -xf -)`
    ]);
    log('backup complete');

    // ── 3. download ──
    setStep('download', `Downloading ${TARGET_TAG}`);
    rmrf(STAGING);
    fs.mkdirSync(STAGING, { recursive: true });
    const tarPath = path.join(os.tmpdir(), `vps-manager-${Date.now()}.tar.gz`);
    await download(TARBALL_URL, tarPath);
    const size = fs.statSync(tarPath).size;
    if (size < 1024) return finish(false, 'Downloaded archive is empty or truncated');
    log(`downloaded ${(size / 1024 / 1024).toFixed(1)} MB`);

    // GitHub tarballs nest everything under one generated directory.
    run('tar', ['-xzf', tarPath, '-C', STAGING, '--strip-components=1']);
    fs.unlinkSync(tarPath);

    if (!fs.existsSync(path.join(STAGING, 'package.json'))) {
      return finish(false, 'Archive does not look like the panel (no package.json)');
    }

    // Machine-local files come across so the staged build can actually boot.
    for (const rel of PRESERVE) {
      const src = path.join(ROOT, rel);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(STAGING, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }

    // ── 4. install ──
    // NODE_ENV=production is exported on this host and makes a bare install
    // delete every devDependency — vite and tsc vanish and the build dies.
    setStep('install', 'Installing dependencies');
    run('npm', ['install', '--include=dev', '--no-audit', '--no-fund'], {
      cwd: STAGING,
      env: { NODE_ENV: 'development' },
      timeout: 900_000,
    });

    // ── 5. build ──
    setStep('build', 'Building');
    run('./node_modules/.bin/vite', ['build'], {
      cwd: STAGING,
      env: { NODE_ENV: 'development' },
      timeout: 900_000,
    });
    if (!fs.existsSync(path.join(STAGING, 'dist', 'index.html'))) {
      return finish(false, 'Build produced no dist/index.html');
    }

    // ── 6. verify BEFORE touching the live install ──
    setStep('verify', 'Verifying the new build');

    // The server refuses to boot without PASSWORD/JWT_SECRET. Those live in
    // .env, and the runner's own environment may not carry them (a systemd
    // host starts the panel with an EnvironmentFile, not an exported shell).
    // Read them from the preserved .env rather than assuming inheritance.
    const envFile = envFrom(STAGING);

    const probe = spawn('node', [path.join(STAGING, 'server', 'index.cjs')], {
      cwd: STAGING,
      detached: true,
      env: { ...process.env, ...envFile, PORT: String(PROBE_PORT), NODE_ENV: 'production' },
      stdio: ['ignore', fs.openSync(LOG_FILE, 'a'), fs.openSync(LOG_FILE, 'a')],
    });
    const probed = await waitForHttp(PROBE_PORT, 45_000, false);
    try { process.kill(-probe.pid, 'SIGKILL'); } catch { try { probe.kill('SIGKILL'); } catch {} }

    if (!probed) {
      rmrf(STAGING);
      return finish(false, 'The new version failed to start. Nothing was changed.');
    }
    log(`staged build answered: v${probed.version ?? 'unknown (no version endpoint)'}`);
    // Whether the post-restart check can confirm the version depends on the
    // release actually exposing it.
    const canVerifyVersion = !probed.legacy;

    // Identify the process currently serving, so a survivor can be recognised
    // even when it reports the same version. /api/version reports a per-boot
    // id and pid precisely for this.
    const before = await waitForHttp(PORT, 3000, false);
    const beforeId = before?.bootId ?? null;
    const beforePid = before?.pid ?? null;

    // ── 7. swap ──
    setStep('swap', 'Installing the new version');
    await stopPanel(beforePid, strategy);
    await new Promise(r => setTimeout(r, 2500));
    // The old process must be gone before the new one binds, or the restart
    // fails with EADDRINUSE while the stale server keeps answering — which
    // would make the health check below pass against the wrong process.
    if (!waitForPortFree(PORT, 20_000, [beforePid])) {
      // Restoring is pointless: nothing has been swapped yet at this point
      // only because we abort here. Bail before touching anything further.
      return finish(false, `Could not stop the process holding port ${PORT}. Nothing was changed.`);
    }

    // Replace tracked content in place; node_modules comes from staging too so
    // the dependency set always matches the code that was verified with it.
    run('sh', ['-c',
      `cd ${JSON.stringify(STAGING)} && tar -cf - . | (cd ${JSON.stringify(ROOT)} && tar -xf -)`
    ]);
    log('files replaced');
    restoreOwner(owner, ROOT);

    // ── 8. restart ──
    setStep('restart', 'Restarting the panel');
    // The strategy was chosen before the swap, but the swap may have replaced
    // start-panel.sh with the release's own copy — which can hardcode the path
    // of the machine that authored it. Re-evaluate against what is on disk now.
    const finalStrategy = restartStrategy();
    if (finalStrategy.kind !== strategy.kind) {
      log(`restart strategy changed after swap: ${strategy.kind} -> ${finalStrategy.kind}`);
    }
    // A restart command that THROWS must still reach the rollback below.
    // Previously a failing `pm2 restart` propagated out of main() and aborted
    // the run, leaving the new files in place and nothing listening — the one
    // failure mode that actually cost uptime.
    let restartError = null;
    try { startPanel(finalStrategy); }
    catch (err) {
      restartError = err?.message || String(err);
      log(`restart command failed: ${restartError}`);
    }

    const live = await waitForHttp(PORT, restartError ? 20_000 : 60_000, canVerifyVersion);

    // Answering is not enough. It must be a DIFFERENT process than the one
    // serving before the swap: /api/version reports the version captured at
    // boot, so a stale process would otherwise report the newly-swapped
    // version from disk and read as a healthy update.
    const sameProcess = live && (
      (beforeId && live.bootId && live.bootId === beforeId) ||
      (beforePid && live.pid && live.pid === beforePid)
    );
    if (sameProcess) log(`health check answered by the pre-update process (pid ${live.pid}) — restart did not take effect`);

    const wrongVersion = canVerifyVersion && live && live.version !== state.toVersion;
    if (wrongVersion) {
      log(`health check returned ${live.version ? `v${live.version}` : 'no version field'}, expected v${state.toVersion}`);
    }

    if (!live || wrongVersion || sameProcess) {
      // ── rollback ──
      log('panel did not come back; rolling back');
      // Whatever strategy was chosen has just demonstrably failed, so reusing
      // it for the recovery is how a failed update becomes a dead panel.
      const recovery = restartError && finalStrategy.kind !== 'node'
        ? { kind: 'node' }
        : finalStrategy;
      await stopPanel(null, finalStrategy);
      await new Promise(r => setTimeout(r, 2000));
      waitForPortFree(PORT, 20_000, [beforePid, live?.pid]);
      run('sh', ['-c',
        `cd ${JSON.stringify(BACKUP)} && tar -cf - . | (cd ${JSON.stringify(ROOT)} && tar -xf -)`
      ]);
      restoreOwner(owner, ROOT);
      try { startPanel(recovery); }
      catch (err) { log(`rollback restart failed: ${err?.message || err}`); }
      let back = await waitForHttp(PORT, 60_000, false);
      if (!back && recovery.kind !== 'node') {
        log('rollback restart did not answer; retrying with a direct node start');
        try { startPanel({ kind: 'node' }); } catch {}
        back = await waitForHttp(PORT, 45_000, false);
      }
      rmrf(STAGING);
      return finish(false,
        back ? 'New version did not start; previous version restored.'
             : 'New version did not start and the rollback also failed to answer. Check the server manually.',
        true);
    }

    rmrf(STAGING);
    state.toVersion = live.version ?? state.toVersion;
    log(`panel live on v${state.toVersion}`);
    finish(true);
  } catch (err) {
    finish(false, err?.message || String(err));
  }
}

main();
