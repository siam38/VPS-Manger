/**
 * platform.cjs — runtime host detection.
 *
 * The panel used to hard-code `/home/ubuntu` and `/root` in a dozen places.
 * That works on exactly one machine. On a Debian VPS the admin user is
 * `debian`, on Arch it's `arch`, on a fresh cloud image it's whatever the
 * provider picked — and every one of those assumptions silently produced
 * wrong behaviour rather than a clean error:
 *
 *   - git ran with HOME=/home/ubuntu, so it read no config and found no key
 *   - `pm2 startup` emitted a unit for a PM2_HOME the daemon wasn't using
 *   - the file browser opened at /root even when nothing lived there
 *
 * Everything here is detected once at boot and exported. No caller should
 * ever write a literal home path again.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/* ── Effective user ────────────────────────────────────────────────────────
 * The panel runs via `sudo -n -E`, and -E *preserves* the invoker's HOME.
 * So `os.homedir()` (which just reads $HOME) reports the launching user's
 * home while the process actually runs as uid 0. os.userInfo() reads the
 * passwd entry for the effective uid, which is the truth.
 * This exact mismatch caused the terminal-cwd bug and the PM2_HOME split.
 */
function effectiveUser() {
  try {
    const info = os.userInfo();
    return { name: info.username, uid: info.uid, home: info.homedir };
  } catch {
    // userInfo() throws if the uid has no passwd entry (some containers).
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    return { name: uid === 0 ? 'root' : String(uid), uid, home: uid === 0 ? '/root' : os.homedir() };
  }
}

const USER = effectiveUser();
const IS_ROOT = USER.uid === 0;

/* The user who invoked sudo, if any. Their home is where SSH keys and git
 * config usually live, because that's the human's account. */
const SUDO_USER = process.env.SUDO_USER || null;

function homeOf(username) {
  if (!username) return null;
  try {
    const line = fs.readFileSync('/etc/passwd', 'utf8')
      .split('\n').find(l => l.startsWith(username + ':'));
    if (line) {
      const home = line.split(':')[5];
      if (home) return home;
    }
  } catch { /* fall through */ }
  const guess = username === 'root' ? '/root' : `/home/${username}`;
  return fs.existsSync(guess) ? guess : null;
}

const SUDO_HOME = SUDO_USER ? homeOf(SUDO_USER) : null;

/* ── Human accounts ───────────────────────────────────────────────────────
 * Real login accounts, from passwd. Used to seed the file browser and to
 * find SSH keys without guessing a username.
 */
function humanUsers() {
  const users = [];
  try {
    for (const line of fs.readFileSync('/etc/passwd', 'utf8').split('\n')) {
      const [name, , uidStr, , , home, shell] = line.split(':');
      if (!name || !home) continue;
      const uid = Number(uidStr);
      const realShell = shell && !/(nologin|false)$/.test(shell);
      // uid 0 is root; 1000+ are human accounts on Debian/Ubuntu/Arch alike.
      if ((uid === 0 || uid >= 1000) && uid < 65534 && realShell && fs.existsSync(home)) {
        users.push({ name, uid, home });
      }
    }
  } catch { /* no passwd readable */ }
  if (!users.length) users.push({ name: USER.name, uid: USER.uid, home: USER.home });
  return users;
}

const USERS = humanUsers();

/* ── SSH identity ─────────────────────────────────────────────────────────
 * Look for a usable key in priority order rather than assuming one path:
 * the invoking human first (their key is the one registered with GitHub),
 * then the effective user, then any other account.
 */
function findSshHome() {
  const candidates = [];
  if (SUDO_HOME) candidates.push(SUDO_HOME);
  candidates.push(USER.home);
  for (const u of USERS) if (!candidates.includes(u.home)) candidates.push(u.home);

  for (const home of candidates) {
    for (const key of ['id_ed25519', 'id_rsa', 'id_ecdsa']) {
      const kp = path.join(home, '.ssh', key);
      try {
        if (fs.existsSync(kp)) return { home, keyPath: kp, keyType: key.replace('id_', '') };
      } catch { /* unreadable, keep looking */ }
    }
  }
  // No key yet — return where we'd create one.
  const home = SUDO_HOME || USER.home;
  return { home, keyPath: path.join(home, '.ssh', 'id_ed25519'), keyType: 'ed25519' };
}

const SSH = findSshHome();

function gitSshCommand() {
  const kh = path.join(SSH.home, '.ssh', 'known_hosts');
  return `ssh -i ${SSH.keyPath} -o UserKnownHostsFile=${kh} -o IdentitiesOnly=yes`;
}

/* Environment for any git invocation. HOME must point at the account that
 * owns the key and .gitconfig, or git silently behaves like a stranger. */
function gitEnv(extra = {}) {
  return {
    ...process.env,
    HOME: SSH.home,
    GIT_SSH_COMMAND: gitSshCommand(),
    ...extra,
  };
}

/* ── Init system ──────────────────────────────────────────────────────────
 * `pm2 startup` claims "Init System found: systemd" purely because systemctl
 * exists on PATH. Inside a container PID 1 is often tini/docker-init and the
 * generated unit is never executed — the button reports success and nothing
 * starts at boot. Detect from PID 1, not from which binaries are installed.
 */
function detectInit() {
  let pid1 = '';
  try { pid1 = fs.readFileSync('/proc/1/comm', 'utf8').trim(); } catch { /* not linux */ }

  const inContainer =
    fs.existsSync('/.dockerenv') ||
    /docker|containerd|lxc|kubepods/.test(safeRead('/proc/1/cgroup')) ||
    ['tini', 'docker-init', 'dumb-init', 'sh', 'bash', 'tail'].includes(pid1);

  // systemd is only real if it is PID 1 *and* the bus answers.
  let systemdUsable = false;
  if (pid1 === 'systemd') {
    try {
      execSync('systemctl is-system-running', { stdio: 'ignore', timeout: 5000 });
      systemdUsable = true;
    } catch (e) {
      // Non-zero exit is fine (degraded still works); "Failed to connect to
      // bus" is not. If the command ran at all, the bus answered.
      systemdUsable = e.status !== undefined && e.status !== 1 ? false : true;
      if (/bus|not been booted/i.test(String(e.stderr || ''))) systemdUsable = false;
    }
  }

  let kind = 'unknown';
  if (systemdUsable) kind = 'systemd';
  else if (pid1 === 'systemd') kind = 'systemd-unavailable';
  else if (inContainer) kind = 'container';
  else if (fs.existsSync('/sbin/openrc')) kind = 'openrc';
  else if (fs.existsSync('/etc/init.d') && pid1 === 'init') kind = 'sysvinit';

  return { kind, pid1, inContainer, systemdUsable, hasCron: hasCrontab() };
}

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function hasCrontab() {
  try { execSync('command -v crontab', { stdio: 'ignore' }); return true; } catch { return false; }
}

const INIT = detectInit();

/* ── PM2 ──────────────────────────────────────────────────────────────────
 * PM2_HOME decides which dump file `pm2 resurrect` reads. Because of the
 * sudo -E HOME leak, the running daemon can be using a different PM2_HOME
 * than a freshly generated startup unit would assume — so apps "saved"
 * before a reboot silently never come back. Report the daemon's actual home.
 */
function detectPm2Home() {
  if (process.env.PM2_HOME) return { path: process.env.PM2_HOME, source: 'env' };

  // Ask the running daemon where it lives; its argv carries the path.
  try {
    const ps = execSync("ps -eo args --no-headers", { encoding: 'utf8', timeout: 5000 });
    const line = ps.split('\n').find(l => /God Daemon/.test(l));
    const m = line && line.match(/God Daemon\s+\(([^)]+)\)/);
    if (m) return { path: m[1], source: 'daemon' };
  } catch { /* no ps or no daemon */ }

  return { path: path.join(USER.home, '.pm2'), source: 'default' };
}

const PM2 = (() => {
  const home = detectPm2Home();
  const expected = path.join(USER.home, '.pm2');
  return {
    home: home.path,
    homeSource: home.source,
    expectedHome: expected,
    // True when the daemon is running against a different PM2_HOME than the
    // effective user's — the condition that makes resurrect silently no-op.
    homeMismatch: path.resolve(home.path) !== path.resolve(expected),
    dumpFile: path.join(home.path, 'dump.pm2'),
  };
})();

/* ── Filesystem roots ─────────────────────────────────────────────────────
 * Allowed bases were a fixed list containing /root and /home. Keep those,
 * but add every real user home so a Debian box's /home/debian is reachable,
 * and only expose roots that actually exist.
 */
function allowedBases() {
  const bases = new Set(['/root', '/home', '/var/www', '/opt', '/srv', '/tmp']);
  for (const u of USERS) bases.add(u.home);
  if (SUDO_HOME) bases.add(SUDO_HOME);
  return [...bases].filter(b => { try { return fs.existsSync(b); } catch { return false; } });
}

const ALLOWED_BASES = allowedBases();

/* Where the file browser and project pickers should open. Prefer the human's
 * home over /root: that's where projects live on a normal VPS. */
function defaultBrowsePath() {
  const candidates = [SUDO_HOME, ...USERS.filter(u => u.uid !== 0).map(u => u.home), USER.home, '/root'];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* next */ }
  }
  return '/';
}

const DEFAULT_PATH = defaultBrowsePath();

function summary() {
  return {
    user: USER,
    isRoot: IS_ROOT,
    sudoUser: SUDO_USER,
    users: USERS.map(u => ({ name: u.name, uid: u.uid, home: u.home })),
    ssh: { home: SSH.home, keyPath: SSH.keyPath, keyType: SSH.keyType, exists: fs.existsSync(SSH.keyPath) },
    init: INIT,
    pm2: PM2,
    allowedBases: ALLOWED_BASES,
    defaultPath: DEFAULT_PATH,
    platform: { os: os.platform(), release: os.release(), distro: detectDistro(), arch: os.arch() },
  };
}

function detectDistro() {
  try {
    const osr = fs.readFileSync('/etc/os-release', 'utf8');
    const name = osr.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    return name ? name[1] : 'unknown';
  } catch { return 'unknown'; }
}

module.exports = {
  USER, IS_ROOT, SUDO_USER, SUDO_HOME, USERS,
  SSH, gitSshCommand, gitEnv,
  INIT, PM2,
  ALLOWED_BASES, DEFAULT_PATH,
  homeOf, summary, detectDistro,
};
