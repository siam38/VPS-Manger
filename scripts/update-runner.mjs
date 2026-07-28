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
const PORT = process.env.PORT || 48292;

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

/** Wait for an HTTP 200 from a port, polling until timeout. */
function waitForHttp(port, timeoutMs = 60_000) {
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
              try { return resolve(JSON.parse(body)); } catch { return resolve({ ok: true }); }
            }
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
    const list = spawnSync('pm2', ['jlist'], { encoding: 'utf8' });
    if (list.status === 0 && /vps-manager/.test(list.stdout || '')) {
      return { kind: 'pm2', name: 'vps-manager' };
    }
  }
  const script = path.join(ROOT, 'start-panel.sh');
  if (fs.existsSync(script)) return { kind: 'script', script };
  return { kind: 'node' };
}

function stopPanel() {
  // Kill by PID only. A pattern kill can match the updater's own command line.
  try {
    const out = spawnSync('sh', ['-c',
      `ps -eo pid,args | grep -F '${path.join(ROOT, 'server/index.cjs')}' | grep -v grep | awk '{print $1}'`
    ], { encoding: 'utf8' }).stdout || '';
    const pids = out.trim().split('\n').filter(Boolean);
    for (const pid of pids) { try { process.kill(Number(pid), 'SIGTERM'); } catch {} }
    return pids.length;
  } catch { return 0; }
}

function startPanel(strategy) {
  if (strategy.kind === 'systemd') { run('systemctl', ['restart', strategy.unit], { timeout: 120_000 }); return; }
  if (strategy.kind === 'pm2') { run('pm2', ['restart', strategy.name], { timeout: 120_000 }); return; }

  const cmd = strategy.kind === 'script'
    ? ['sh', [strategy.script]]
    : ['node', [path.join(ROOT, 'server', 'index.cjs')]];

  // Detached and fully redirected: the child must outlive this process.
  const child = spawn(cmd[0], cmd[1], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', fs.openSync(LOG_FILE, 'a'), fs.openSync(LOG_FILE, 'a')],
  });
  child.unref();
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
      const real = dirty.trim().split('\n').filter(Boolean);
      if (real.length) {
        return finish(false, `Working tree has ${real.length} uncommitted change(s). Commit or discard them first.`);
      }
    }

    const strategy = restartStrategy();
    log(`restart strategy: ${strategy.kind}${strategy.unit ? ` (${strategy.unit})` : ''}`);

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
    const probe = spawn('node', [path.join(STAGING, 'server', 'index.cjs')], {
      cwd: STAGING,
      detached: true,
      env: { ...process.env, PORT: String(PROBE_PORT), NODE_ENV: 'production' },
      stdio: ['ignore', fs.openSync(LOG_FILE, 'a'), fs.openSync(LOG_FILE, 'a')],
    });
    const probed = await waitForHttp(PROBE_PORT, 45_000);
    try { process.kill(-probe.pid, 'SIGKILL'); } catch { try { probe.kill('SIGKILL'); } catch {} }

    if (!probed) {
      rmrf(STAGING);
      return finish(false, 'The new version failed to start. Nothing was changed.');
    }
    log(`staged build answered: v${probed.version ?? '?'}`);

    // ── 7. swap ──
    setStep('swap', 'Installing the new version');
    stopPanel();
    await new Promise(r => setTimeout(r, 2500));

    // Replace tracked content in place; node_modules comes from staging too so
    // the dependency set always matches the code that was verified with it.
    run('sh', ['-c',
      `cd ${JSON.stringify(STAGING)} && tar -cf - . | (cd ${JSON.stringify(ROOT)} && tar -xf -)`
    ]);
    log('files replaced');

    // ── 8. restart ──
    setStep('restart', 'Restarting the panel');
    startPanel(strategy);
    const live = await waitForHttp(PORT, 60_000);

    if (!live) {
      // ── rollback ──
      log('panel did not come back; rolling back');
      stopPanel();
      await new Promise(r => setTimeout(r, 2000));
      run('sh', ['-c',
        `cd ${JSON.stringify(BACKUP)} && tar -cf - . | (cd ${JSON.stringify(ROOT)} && tar -xf -)`
      ]);
      startPanel(strategy);
      const back = await waitForHttp(PORT, 60_000);
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
