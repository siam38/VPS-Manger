const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const path = require('path');
const os = require('os');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const fsp = fs.promises;
const { exec, execSync } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const archiver = require('archiver');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const crypto = require('crypto');
const platform = require('./platform.cjs');
const sessionStore = require('./sessions.cjs');
const updater = require('./updater.cjs');

const app = express();
const server = http.createServer(app);

// ─── Security Configuration ───
const PORT = process.env.PORT || 48292;

// Validate required environment variables
if (!process.env.PASSWORD) {
  console.error('ERROR: PASSWORD environment variable is required');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error('ERROR: JWT_SECRET environment variable is required');
  process.exit(1);
}

const PASSWORD = process.env.PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const AUDIT_LOG_FILE = path.join(__dirname, 'audit.log');

// Path traversal protection - allowed base directories.
// Detected at boot from /etc/passwd instead of hard-coded, so a Debian box
// (/home/debian) or any other distro works without editing source.
const ALLOWED_BASES = platform.ALLOWED_BASES;

function validatePath(requestedPath) {
  const resolved = path.resolve(requestedPath);
  const allowed = ALLOWED_BASES.some(base => resolved.startsWith(base));
  if (!allowed) {
    auditLog('path_traversal_attempt', 'unknown', 'unknown', { path: requestedPath });
    return null;
  }
  return resolved;
}

/**
 * Locate OpenClaw workspaces anywhere in the allowed roots.
 *
 * Previously the panel hard-coded /home/ubuntu/.openclaw, which is wrong on any
 * box where the agent runs as a different user. This walks the allowed bases
 * looking for `.openclaw` directories and ranks them, so a real workspace (one
 * with AGENTS.md / MEMORY.md / a workspace dir) sorts above a bare state stub
 * like the one root gets.
 */
const OPENCLAW_MARKERS = ['workspace', 'AGENTS.md', 'MEMORY.md', 'openclaw.json', 'skills', 'agents'];

async function findOpenclawDirs() {
  const found = [];
  // Home-style roots hold per-user installs; scan one level down for user dirs.
  const scanRoots = ['/root', '/home', '/opt'].filter(r => fs.existsSync(r));

  const inspect = async (dir) => {
    try {
      const entries = await fsp.readdir(dir);
      let score = 0;
      const has = [];
      for (const m of OPENCLAW_MARKERS) {
        if (entries.includes(m)) { score += 1; has.push(m); }
      }
      const st = await fsp.stat(dir);
      found.push({
        path: dir,
        score,
        markers: has,
        entries: entries.length,
        modified: st.mtime,
        // A workspace subdir is the useful landing spot when it exists.
        workspace: entries.includes('workspace') ? path.join(dir, 'workspace') : null,
      });
    } catch { /* unreadable: skip */ }
  };

  for (const root of scanRoots) {
    // <root>/.openclaw
    try {
      const direct = path.join(root, '.openclaw');
      if ((await fsp.stat(direct)).isDirectory()) await inspect(direct);
    } catch {}

    // <root>/<user>/.openclaw
    try {
      const users = await fsp.readdir(root, { withFileTypes: true });
      for (const u of users) {
        if (!u.isDirectory() || u.name.startsWith('.')) continue;
        try {
          const candidate = path.join(root, u.name, '.openclaw');
          if ((await fsp.stat(candidate)).isDirectory()) await inspect(candidate);
        } catch {}
      }
    } catch {}
  }

  // Richest install first; break ties on recency.
  found.sort((a, b) =>
    b.score - a.score ||
    b.entries - a.entries ||
    new Date(b.modified) - new Date(a.modified)
  );
  return found;
}

// ─── IP Lockout System ───
const failedAttempts = new Map(); // IP -> { count, lockedUntil }

function isIPLocked(ip) {
  const attempt = failedAttempts.get(ip);
  if (!attempt) return false;
  
  if (attempt.lockedUntil && Date.now() < attempt.lockedUntil) {
    return { locked: true, remainingTime: Math.ceil((attempt.lockedUntil - Date.now()) / 1000) };
  }
  
  // Clean up expired lockouts
  if (attempt.lockedUntil && Date.now() >= attempt.lockedUntil) {
    failedAttempts.delete(ip);
  }
  
  return false;
}

function recordFailedAttempt(ip) {
  const attempt = failedAttempts.get(ip) || { count: 0, lockedUntil: null };
  attempt.count++;
  
  if (attempt.count >= 5) {
    attempt.lockedUntil = Date.now() + (30 * 60 * 1000); // 30 minutes
  }
  
  failedAttempts.set(ip, attempt);
}

function clearFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

// Auto-cleanup expired lockouts every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, attempt] of failedAttempts.entries()) {
    if (attempt.lockedUntil && now >= attempt.lockedUntil) {
      failedAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// ─── Audit Logging ───
function auditLog(action, ip, userAgent, details = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = JSON.stringify({
    timestamp,
    action,
    ip,
    userAgent,
    ...details
  });
  
  fs.appendFileSync(AUDIT_LOG_FILE, logEntry + '\n');
}

// ─── HTTPS Certificate Generation ───


// ─── Rate Limiting ───
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// Refresh is a normal part of an active session — roughly four times an hour
// per tab — so this ceiling only catches something genuinely abusive.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many refresh attempts.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// ─── Middleware ───
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"],
      workerSrc: ["'self'", "blob:"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: null, // Disable — we're on plain HTTP
    },
  },
}));

// Add compression middleware
app.use(compression());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Trust proxy for proper IP detection
app.set('trust proxy', 1);

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'dist')));

// ─── Auth helpers ───
//
// Access tokens are deliberately short lived. They are the only credential a
// script on the page can read, so their value to an attacker is capped at this
// window. Continuity comes from the httpOnly refresh cookie instead — see
// server/sessions.cjs.
const ACCESS_TTL = '15m';

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

/**
 * Minimal cookie reader.
 *
 * Deliberately not pulling in cookie-parser: we need exactly one cookie, and
 * a transitive `cookie` package that happens to be installed today is not a
 * dependency we control.
 */
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(idx + 1).trim()); }
    catch { return null; }
  }
  return null;
}

/**
 * The panel is served over plain HTTP locally and over HTTPS through the
 * Cloudflare Tunnel. Hard-coding `secure: true` would silently drop the cookie
 * on the local origin, so it follows the actual protocol the request arrived
 * on. `trust proxy` is already set, so req.secure reflects X-Forwarded-Proto.
 */
function setRefreshCookie(req, res, token) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.cookie(sessionStore.COOKIE_NAME, token, {
    httpOnly: true,      // unreadable from JavaScript, so XSS cannot lift it
    sameSite: 'strict',  // not sent cross-site, so CSRF cannot drive a refresh
    secure,
    path: '/api',        // only ever sent to the API, never to static assets
    maxAge: sessionStore.REFRESH_TTL_MS,
  });
}

function clearRefreshCookie(req, res) {
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.clearCookie(sessionStore.COOKIE_NAME, {
    httpOnly: true, sameSite: 'strict', secure, path: '/api',
  });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) {
    auditLog('auth_failed', req.ip, req.get('User-Agent'), { reason: 'no_token' });
    return res.status(401).json({ error: 'No token provided' });
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    auditLog('auth_failed', req.ip, req.get('User-Agent'), { reason: 'invalid_token' });
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.user = decoded;
  next();
}

// Timing-safe password comparison
function timingSafePasswordCompare(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') {
    return false;
  }
  
  // Ensure both strings have the same length for timing safety
  const inputBuffer = Buffer.from(input, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  
  // If lengths don't match, still compare to prevent timing attacks
  if (inputBuffer.length !== expectedBuffer.length) {
    // Compare against a dummy buffer of the same length as expected
    const dummyBuffer = Buffer.alloc(expectedBuffer.length);
    crypto.timingSafeEqual(dummyBuffer, expectedBuffer);
    return false;
  }
  
  return crypto.timingSafeEqual(inputBuffer, expectedBuffer);
}

// ─── Auth routes ───
app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  const clientIP = req.ip;
  const userAgent = req.get('User-Agent') || '';
  
  // Check if IP is locked
  const lockStatus = isIPLocked(clientIP);
  if (lockStatus && lockStatus.locked) {
    auditLog('login_attempt', clientIP, userAgent, { 
      result: 'blocked_locked_ip', 
      remainingTime: lockStatus.remainingTime 
    });
    return res.status(403).json({ 
      error: `IP locked due to multiple failed attempts. Try again in ${Math.ceil(lockStatus.remainingTime / 60)} minutes.` 
    });
  }
  
  if (!password) {
    auditLog('login_attempt', clientIP, userAgent, { result: 'no_password' });
    return res.status(400).json({ error: 'Password required' });
  }
  
  // Minimum password length check
  if (password.length < 6) {
    recordFailedAttempt(clientIP);
    auditLog('login_attempt', clientIP, userAgent, { result: 'password_too_short' });
    return res.status(401).json({ error: 'Invalid password' });
  }
  
  // Timing-safe password comparison
  if (!timingSafePasswordCompare(password, PASSWORD)) {
    recordFailedAttempt(clientIP);
    auditLog('login_attempt', clientIP, userAgent, { result: 'invalid_password' });
    return res.status(401).json({ error: 'Invalid password' });
  }
  
  // Success - clear failed attempts and issue credentials
  clearFailedAttempts(clientIP);
  const token = generateToken({ authenticated: true, ts: Date.now() });
  const { token: refreshToken } = sessionStore.issue({
    ip: clientIP,
    userAgent,
  });
  setRefreshCookie(req, res, refreshToken);
  auditLog('login_attempt', clientIP, userAgent, { result: 'success' });

  res.json({ success: true, token, expiresIn: 900 });
});

app.get('/api/verify', authMiddleware, (req, res) => {
  res.json({ valid: true });
});

// ─── Token refresh ───
//
// Called by the browser shortly before the access token expires, and once on
// page load. Authorised by the httpOnly refresh cookie alone — an expired
// access token must still be able to refresh, otherwise the whole mechanism
// would be pointless.
app.post('/api/refresh', refreshLimiter, (req, res) => {
  const clientIP = req.ip;
  const userAgent = req.get('User-Agent') || '';
  const presented = readCookie(req, sessionStore.COOKIE_NAME);

  if (!presented) {
    return res.status(401).json({ error: 'No session' });
  }

  const result = sessionStore.rotate(presented, { ip: clientIP, userAgent });

  if (!result.ok) {
    // A lost race means another tab rotated microseconds earlier and the
    // cookie it set is already the live one. Ask this tab to retry rather
    // than destroying a perfectly good session.
    if (result.reason === 'race') {
      return res.status(409).json({ error: 'Refresh in progress', retry: true });
    }
    if (result.reason === 'reuse') {
      auditLog('token_refresh', clientIP, userAgent, { result: 'reuse_detected' });
    } else {
      auditLog('token_refresh', clientIP, userAgent, { result: result.reason });
    }
    clearRefreshCookie(req, res);
    return res.status(401).json({ error: 'Session expired' });
  }

  setRefreshCookie(req, res, result.token);
  const newToken = generateToken({ authenticated: true, ts: Date.now() });
  auditLog('token_refresh', clientIP, userAgent, { result: 'success' });

  res.json({ success: true, token: newToken, expiresIn: 900 });
});

// ─── Logout ───
//
// Revokes the whole token family server-side. Dropping the client's copy is
// not enough — a refresh token that still validates is a live credential.
app.post('/api/logout', (req, res) => {
  const presented = readCookie(req, sessionStore.COOKIE_NAME);
  if (presented) sessionStore.revoke(presented);
  clearRefreshCookie(req, res);
  auditLog('logout', req.ip, req.get('User-Agent'), { result: 'success' });
  res.json({ success: true });
});

// Active sign-ins, and a way to cut them all off from any one of them.
app.get('/api/sessions', authMiddleware, (req, res) => {
  res.json({ sessions: sessionStore.list() });
});

app.post('/api/sessions/revoke-all', authMiddleware, (req, res) => {
  sessionStore.revokeAll();
  clearRefreshCookie(req, res);
  auditLog('sessions_revoked', req.ip, req.get('User-Agent'), { scope: 'all' });
  res.json({ success: true });
});

// The old /api/refresh lived here: it renewed an access token using that same
// access token, so once it expired there was nothing left to refresh with and
// the user was bounced to the login form. Nothing on the frontend ever called
// it anyway. Replaced by the cookie-authorised route above.

// ─── Audit Logs Route ───
app.get('/api/audit/logs', authMiddleware, async (req, res) => {
  try {
    if (!fs.existsSync(AUDIT_LOG_FILE)) {
      return res.json({ logs: [] });
    }
    
    const content = await fsp.readFile(AUDIT_LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);
    
    // Get last 200 entries
    const recentLines = lines.slice(-200);
    const logs = recentLines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { timestamp: new Date().toISOString(), action: 'parse_error', raw: line };
      }
    });
    
    res.json({ logs: logs.reverse() }); // Most recent first
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── System routes ───
/**
 * Host layout, detected at runtime.
 *
 * The frontend used to carry its own copy of ALLOWED_BASES and open the file
 * browser at a literal '/root'. On a Debian VPS the admin home is
 * /home/debian, so both were wrong. The client now asks the server what this
 * machine actually looks like instead of guessing.
 */
app.get('/api/system/platform', authMiddleware, (req, res) => {
  try {
    res.json(platform.summary());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/system/info', authMiddleware, async (req, res) => {
  try {
    const hostname = os.hostname();
    const platform = `${os.platform()} ${os.release()}`;
    const arch = os.arch();
    const uptime = os.uptime();
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    // IP
    const nets = os.networkInterfaces();
    let ip = '127.0.0.1';
    Object.values(nets).forEach(addrs => addrs.forEach(a => { if (!a.internal && a.family === 'IPv4') ip = a.address; }));

    // Disk
    let disk = null;
    try {
      const { stdout } = await execAsync("df -B1 / | tail -1 | awk '{print $2,$3,$4,$5}'");
      const [total, used, avail, pct] = stdout.trim().split(' ');
      disk = { total: parseInt(total), used: parseInt(used), available: parseInt(avail), percentage: parseFloat(pct) };
    } catch {}

    // Network stats
    let network = { rx: 0, tx: 0 };
    try {
      const { stdout } = await execAsync("cat /proc/net/dev | grep -v lo | grep ':' | awk '{rx+=$2; tx+=$10} END {print rx, tx}'");
      const [rx, tx] = stdout.trim().split(' ');
      network = { rx: parseInt(rx), tx: parseInt(tx) };
    } catch {}

    res.json({ hostname, platform, arch, uptime, cpuCount: cpus.length, cpuModel: cpus[0]?.model || 'Unknown',
      memory: { total: totalMem, free: freeMem, used: totalMem - freeMem },
      disk, ip, network });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/system/stats', authMiddleware, async (req, res) => {
  try {
    let cpuUsage = 0;
    try {
      const { stdout } = await execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1");
      cpuUsage = parseFloat(stdout.trim()) || 0;
    } catch {}

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    let disk = null;
    try {
      const { stdout } = await execAsync("df -B1 / | tail -1 | awk '{print $2,$3,$4,$5}'");
      const [total, used, avail, pct] = stdout.trim().split(' ');
      disk = { total: parseInt(total), used: parseInt(used), available: parseInt(avail), percentage: parseFloat(pct) };
    } catch {}

    let network = { rx: 0, tx: 0 };
    try {
      const { stdout } = await execAsync("cat /proc/net/dev | grep -v lo | grep ':' | awk '{rx+=$2; tx+=$10} END {print rx, tx}'");
      const [rx, tx] = stdout.trim().split(' ');
      network = { rx: parseInt(rx), tx: parseInt(tx) };
    } catch {}

    // Load average
    const loadAvg = os.loadavg();

    res.json({ cpu: cpuUsage, memory: { total: totalMem, used: usedMem, free: freeMem, percentage: (usedMem / totalMem) * 100 },
      disk, network, loadAvg, timestamp: Date.now() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Quick actions - now with audit logging
app.post('/api/system/action/:action', authMiddleware, async (req, res) => {
  const { action } = req.params;
  const clientIP = req.ip;
  const userAgent = req.get('User-Agent') || '';
  
  auditLog('system_action', clientIP, userAgent, { action });
  
  try {
    switch (action) {
      case 'clear-cache':
        await execAsync('sync && echo 3 > /proc/sys/vm/drop_caches');
        return res.json({ success: true, message: 'Cache cleared' });
      case 'restart-nginx':
        await execAsync('systemctl restart nginx');
        return res.json({ success: true, message: 'Nginx restarted' });
      case 'restart-ssh':
        await execAsync('systemctl restart ssh');
        return res.json({ success: true, message: 'SSH restarted' });
      case 'restart-pm2':
        await execAsync('pm2 restart all');
        return res.json({ success: true, message: 'PM2 all apps restarted' });
      case 'system-update': {
        const { stdout } = await execAsync('apt update 2>&1', { timeout: 60000 });
        return res.json({ success: true, message: 'System update check complete', output: stdout });
      }
      case 'disk-usage': {
        const { stdout } = await execAsync('df -h && echo "\\n--- Largest dirs in / ---" && du -sh /* 2>/dev/null | sort -rh | head -15');
        return res.json({ success: true, message: 'Disk usage', output: stdout });
      }
      case 'system-logs': {
        const { stdout } = await execAsync('journalctl -xe --no-pager -n 50 2>&1');
        return res.json({ success: true, message: 'System logs', output: stdout });
      }
      case 'restart-docker':
        await execAsync('systemctl restart docker');
        return res.json({ success: true, message: 'Docker restarted' });
      case 'restart-openclaw':
        await execAsync('openclaw gateway restart');
        return res.json({ success: true, message: 'OpenClaw restarted' });
      case 'network-info': {
        const { stdout } = await execAsync('ip addr && echo "\\n--- Routes ---" && ip route');
        return res.json({ success: true, message: 'Network info', output: stdout });
      }
      case 'clear-tmp':
        await execAsync('find /tmp -type f -atime +2 -delete 2>/dev/null; echo done');
        return res.json({ success: true, message: 'Temp files cleared' });
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) { 
    auditLog('system_action_error', clientIP, userAgent, { action, error: e.message });
    res.status(500).json({ error: e.message }); 
  }
});

// ─── File routes ───
const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 100 * 1024 * 1024 } });

// Where are the OpenClaw workspaces on this box? Detected, never hard-coded.
app.get('/api/files/openclaw', authMiddleware, async (req, res) => {
  try {
    const dirs = await findOpenclawDirs();
    res.json({
      found: dirs.length > 0,
      // Best landing spot: the workspace dir when one exists, else the root.
      primary: dirs.length ? (dirs[0].workspace || dirs[0].path) : null,
      dirs: dirs.map(d => ({
        path: d.path,
        workspace: d.workspace,
        markers: d.markers,
        entries: d.entries,
        // A bare `state`-only stub is not a real workspace; let the UI say so.
        stub: d.score === 0,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/files/list', authMiddleware, async (req, res) => {
  const dirPath = req.query.path || '/';
  const showHidden = req.query.hidden === 'true';
  try {
    const resolved = validatePath(dirPath);
    if (!resolved) return res.status(403).json({ error: 'Access denied - path not allowed' });
    const entries = await fsp.readdir(resolved);
    const items = [];
    for (const entry of entries) {
      if (!showHidden && entry.startsWith('.')) continue;
      try {
        const full = path.join(resolved, entry);
        const st = await fsp.stat(full);
        items.push({ name: entry, path: full, isDirectory: st.isDirectory(), size: st.size, modified: st.mtime,
          permissions: st.mode.toString(8).slice(-3) });
      } catch {}
    }
    items.sort((a, b) => { if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1; return a.name.localeCompare(b.name); });
    res.json({ path: resolved, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/files/content', authMiddleware, async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    const resolved = validatePath(filePath);
    if (!resolved) return res.status(403).json({ error: 'Access denied - path not allowed' });
    const st = await fsp.stat(resolved);
    if (st.isDirectory()) return res.status(400).json({ error: 'Is a directory' });
    if (st.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large (>5MB)' });
    // Check binary — only check the bytes actually read
    const buf = Buffer.alloc(Math.min(512, st.size));
    const fd = await fsp.open(resolved, 'r');
    const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
    await fd.close();
    if (bytesRead > 0 && buf.slice(0, bytesRead).includes(0)) return res.status(400).json({ error: 'Binary file' });
    const content = await fsp.readFile(resolved, 'utf8');
    res.json({ content, path: resolved, size: st.size, modified: st.mtime });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/save', authMiddleware, async (req, res) => {
  const { path: fp, content } = req.body;
  if (!fp || content === undefined) return res.status(400).json({ error: 'path and content required' });
  try {
    const resolved = validatePath(fp);
    if (!resolved) return res.status(403).json({ error: 'Access denied - path not allowed' });
    await fsp.mkdir(path.dirname(resolved), { recursive: true });
    await fsp.writeFile(resolved, content, 'utf8');
    const st = await fsp.stat(resolved);
    
    auditLog('file_save', req.ip, req.get('User-Agent'), { path: resolved });
    
    // Smart restart: check if saved file belongs to a PM2 app with smart_restart enabled
    const restarted = await smartRestartForPath(resolved);
    
    res.json({ success: true, path: resolved, size: st.size, restarted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/mkdir', authMiddleware, async (req, res) => {
  const { path: dp, name } = req.body;
  if (!dp || !name) return res.status(400).json({ error: 'path and name required' });
  try {
    const full = validatePath(path.join(dp, name));
    if (!full) return res.status(403).json({ error: 'Access denied - path not allowed' });
    await fsp.mkdir(full, { recursive: true });
    
    auditLog('file_mkdir', req.ip, req.get('User-Agent'), { path: full });
    res.json({ success: true, path: full });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/files/delete', authMiddleware, async (req, res) => {
  const { path: fp } = req.body;
  if (!fp) return res.status(400).json({ error: 'path required' });
  try {
    const resolved = validatePath(fp);
    if (!resolved) return res.status(403).json({ error: 'Access denied - path not allowed' });
    await fsp.rm(resolved, { recursive: true, force: true });
    
    auditLog('file_delete', req.ip, req.get('User-Agent'), { path: resolved });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/rename', authMiddleware, async (req, res) => {
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath required' });
  try {
    const resolvedOld = validatePath(oldPath);
    const resolvedNew = validatePath(newPath);
    if (!resolvedOld || !resolvedNew) return res.status(403).json({ error: 'Access denied - path not allowed' });
    await fsp.rename(resolvedOld, resolvedNew);
    
    auditLog('file_rename', req.ip, req.get('User-Agent'), { oldPath: resolvedOld, newPath: resolvedNew });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/copy', authMiddleware, async (req, res) => {
  const { sourcePath, destPath } = req.body;
  if (!sourcePath || !destPath) return res.status(400).json({ error: 'sourcePath and destPath required' });
  try {
    const resolvedSource = validatePath(sourcePath);
    const resolvedDest = validatePath(destPath);
    if (!resolvedSource || !resolvedDest) return res.status(403).json({ error: 'Access denied - path not allowed' });
    
    const st = await fsp.stat(resolvedSource);
    if (st.isDirectory()) {
      await execAsync('cp', ['-r', resolvedSource, resolvedDest]);
    } else {
      await fsp.copyFile(resolvedSource, resolvedDest);
    }
    
    auditLog('file_copy', req.ip, req.get('User-Agent'), { sourcePath: resolvedSource, destPath: resolvedDest });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/files/upload', authMiddleware, upload.array('files'), async (req, res) => {
  const uploadDir = req.body.path || '/';
  if (!req.files?.length) return res.status(400).json({ error: 'No files' });
  try {
    const resolved = validatePath(uploadDir);
    if (!resolved) return res.status(403).json({ error: 'Access denied - path not allowed' });
    const uploaded = [];
    for (const file of req.files) {
      const dest = path.join(resolved, file.originalname);
      await fsp.rename(file.path, dest);
      uploaded.push(dest);
    }
    
    auditLog('file_upload', req.ip, req.get('User-Agent'), { files: uploaded });
    res.json({ success: true, files: uploaded });
  } catch (e) {
    for (const f of req.files) { try { await fsp.unlink(f.path); } catch {} }
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/download', authMiddleware, async (req, res) => {
  const fp = req.query.path;
  if (!fp) return res.status(400).json({ error: 'path required' });
  try {
    const resolved = validatePath(fp);
    if (!resolved) return res.status(403).json({ error: 'Access denied - path not allowed' });
    const st = await fsp.stat(resolved);
    
    auditLog('file_download', req.ip, req.get('User-Agent'), { path: resolved });
    
    if (st.isDirectory()) {
      const archive = archiver('zip', { zlib: { level: 9 } });
      res.attachment(path.basename(resolved) + '.zip');
      archive.pipe(res);
      archive.directory(resolved, false);
      await archive.finalize();
    } else {
      res.download(resolved);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Process routes ───
app.get('/api/processes/list', authMiddleware, async (req, res) => {
  try {
    const { stdout } = await execAsync('ps aux --sort=-%cpu');
    const lines = stdout.trim().split('\n');
    const procs = [];
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].trim().split(/\s+/);
      if (p.length >= 11) {
        procs.push({ user: p[0], pid: parseInt(p[1]), cpu: parseFloat(p[2]) || 0, memory: parseFloat(p[3]) || 0,
          vsz: parseInt(p[4]) || 0, rss: parseInt(p[5]) || 0, tty: p[6], stat: p[7], start: p[8], time: p[9],
          command: p.slice(10).join(' ') });
      }
    }
    res.json(procs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/processes/kill', authMiddleware, async (req, res) => {
  const { pid, signal = 'TERM' } = req.body;
  if (!pid) return res.status(400).json({ error: 'pid required' });
  const valid = ['TERM', 'KILL', 'HUP', 'INT', 'QUIT', 'STOP', 'CONT'];
  if (!valid.includes(signal)) return res.status(400).json({ error: 'Invalid signal' });
  try {
    await execAsync(`kill -${signal} ${pid}`);
    
    auditLog('process_kill', req.ip, req.get('User-Agent'), { pid, signal });
    res.json({ success: true, message: `Sent ${signal} to ${pid}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Smart Restart: restart PM2 apps whose cwd matches a changed file path ───
async function smartRestartForPath(filePath) {
  try {
    const resolved = path.resolve(filePath);
    const { stdout } = await execAsync('pm2 jlist');
    const apps = JSON.parse(stdout || '[]');
    const restarted = [];
    for (const app of apps) {
      const env = app.pm2_env || {};
      const appCwd = env.pm_cwd || env.cwd || '';
      if (appCwd && resolved.startsWith(path.resolve(appCwd) + '/')) {
        // Check if smart_restart is enabled for this app
        const smartRestart = env.env && env.env.PANEL_SMART_RESTART;
        if (smartRestart === 'true' || smartRestart === '1') {
          await execAsync(`pm2 restart "${app.name}"`);
          restarted.push(app.name);
        }
      }
    }
    return restarted;
  } catch { return []; }
}

// Restart PM2 app by name (for git-sync integration)
async function restartPm2App(appName) {
  try {
    await execAsync(`pm2 restart "${appName}"`);
    return true;
  } catch { return false; }
}

// ─── Smart Restart toggle for PM2 apps ───
app.post('/api/pm2/smart-restart', authMiddleware, async (req, res) => {
  const { name, enabled } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    // Set env var PANEL_SMART_RESTART on the app
    if (enabled) {
      await execAsync(`pm2 set "${name}:PANEL_SMART_RESTART" "true" 2>/dev/null || true`);
      // Use ecosystem restart to inject the env var
      const { stdout } = await execAsync('pm2 jlist');
      const apps = JSON.parse(stdout || '[]');
      const app = apps.find(a => a.name === name);
      if (app) {
        const env = app.pm2_env || {};
        const ecoPath = path.join(os.tmpdir(), `pm2-sr-${name}-${Date.now()}.json`);
        const ecosystem = {
          apps: [{
            name,
            script: env.pm_exec_path,
            cwd: env.pm_cwd || env.cwd,
            exec_mode: (env.exec_mode || 'fork').replace('_mode', ''),
            instances: env.instances || 1,
            watch: env.watch || false,
            ignore_watch: env.ignore_watch || undefined,
            interpreter: env.exec_interpreter || 'node',
            autorestart: env.autorestart !== false,
            env: { ...((env.env || {})), PANEL_SMART_RESTART: 'true' },
          }]
        };
        fs.writeFileSync(ecoPath, JSON.stringify(ecosystem, null, 2));
        await execAsync(`pm2 delete "${name}" && pm2 start ${ecoPath}`);
        try { fs.unlinkSync(ecoPath); } catch {}
        await execAsync('pm2 save');
      }
    } else {
      // Disable: restart without the env var
      const { stdout } = await execAsync('pm2 jlist');
      const apps = JSON.parse(stdout || '[]');
      const app = apps.find(a => a.name === name);
      if (app) {
        const env = app.pm2_env || {};
        const newEnv = { ...(env.env || {}) };
        delete newEnv.PANEL_SMART_RESTART;
        const ecoPath = path.join(os.tmpdir(), `pm2-sr-${name}-${Date.now()}.json`);
        const ecosystem = {
          apps: [{
            name,
            script: env.pm_exec_path,
            cwd: env.pm_cwd || env.cwd,
            exec_mode: (env.exec_mode || 'fork').replace('_mode', ''),
            instances: env.instances || 1,
            watch: env.watch || false,
            ignore_watch: env.ignore_watch || undefined,
            interpreter: env.exec_interpreter || 'node',
            autorestart: env.autorestart !== false,
            env: newEnv,
          }]
        };
        fs.writeFileSync(ecoPath, JSON.stringify(ecosystem, null, 2));
        await execAsync(`pm2 delete "${name}" && pm2 start ${ecoPath}`);
        try { fs.unlinkSync(ecoPath); } catch {}
        await execAsync('pm2 save');
      }
    }
    auditLog('pm2_smart_restart_toggle', req.ip, req.get('User-Agent'), { name, enabled });
    res.json({ success: true, name, smart_restart: !!enabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PM2 routes ───
app.get('/api/pm2/list', authMiddleware, async (req, res) => {
  try {
    const { stdout } = await execAsync('pm2 jlist');
    res.json(JSON.parse(stdout || '[]'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pm2/start', authMiddleware, async (req, res) => {
  const { name_or_id } = req.body;
  if (!name_or_id) return res.status(400).json({ error: 'name_or_id required' });
  try {
    await execAsync(`pm2 start "${name_or_id}"`);
    
    auditLog('pm2_start', req.ip, req.get('User-Agent'), { name_or_id });
    res.json({ success: true, message: `Started ${name_or_id}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pm2/stop', authMiddleware, async (req, res) => {
  const { name_or_id } = req.body;
  if (!name_or_id) return res.status(400).json({ error: 'name_or_id required' });
  try {
    await execAsync(`pm2 stop "${name_or_id}"`);
    
    auditLog('pm2_stop', req.ip, req.get('User-Agent'), { name_or_id });
    res.json({ success: true, message: `Stopped ${name_or_id}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pm2/restart', authMiddleware, async (req, res) => {
  const { name_or_id } = req.body;
  if (!name_or_id) return res.status(400).json({ error: 'name_or_id required' });
  try {
    await execAsync(`pm2 restart "${name_or_id}"`);
    
    auditLog('pm2_restart', req.ip, req.get('User-Agent'), { name_or_id });
    res.json({ success: true, message: `Restarted ${name_or_id}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pm2/delete', authMiddleware, async (req, res) => {
  const { name_or_id } = req.body;
  if (!name_or_id) return res.status(400).json({ error: 'name_or_id required' });
  try {
    await execAsync(`pm2 delete "${name_or_id}"`);
    
    auditLog('pm2_delete', req.ip, req.get('User-Agent'), { name_or_id });
    res.json({ success: true, message: `Deleted ${name_or_id}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/pm2/logs/:name', authMiddleware, async (req, res) => {
  try {
    const { stdout } = await execAsync(`pm2 logs "${req.params.name}" --nostream --lines 200`);
    res.json({ logs: stdout });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pm2/start-new', authMiddleware, async (req, res) => {
  const { script, name, cwd } = req.body;
  if (!script || !name) return res.status(400).json({ error: 'script and name required' });
  try {
    let cmd = `pm2 start "${script}" --name "${name}"`;
    if (cwd) cmd += ` --cwd "${cwd}"`;
    await execAsync(cmd);
    
    auditLog('pm2_start_new', req.ip, req.get('User-Agent'), { script, name, cwd });
    res.json({ success: true, message: `Started ${name}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PM2 Extended Routes ───

// Browse directories + detect project files
app.get('/api/pm2/browse-dirs', authMiddleware, async (req, res) => {
  try {
    const dirPath = req.query.path || platform.DEFAULT_PATH;
    const resolvedPath = path.resolve(dirPath);
    const entries = await fsp.readdir(resolvedPath, { withFileTypes: true });
    
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(resolvedPath, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const projectFileNames = [
      'package.json', 'index.js', 'app.js', 'server.js', 'main.js', 'bot.js',
      'ecosystem.config.js', 'ecosystem.config.cjs', 'index.cjs', 'app.cjs', 'server.cjs',
      'index.ts', 'app.ts', 'server.ts', 'main.ts', 'bot.ts',
      'index.mjs', 'app.mjs', 'server.mjs',
      'main.py', 'app.py', 'bot.py', 'manage.py',
      'Procfile', 'Dockerfile'
    ];

    const projectFiles = entries
      .filter(e => e.isFile() && (projectFileNames.includes(e.name) || e.name.endsWith('.cjs')))
      .map(e => {
        let type = 'script';
        if (e.name === 'package.json') type = 'package';
        else if (e.name.startsWith('ecosystem.config')) type = 'ecosystem';
        else if (e.name === 'Procfile') type = 'procfile';
        else if (e.name === 'Dockerfile') type = 'docker';
        else if (e.name.endsWith('.py')) type = 'python';
        else if (e.name.endsWith('.ts')) type = 'typescript';
        return { name: e.name, path: path.join(resolvedPath, e.name), type };
      });

    res.json({
      path: resolvedPath,
      parent: path.dirname(resolvedPath),
      dirs,
      projectFiles
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Extended app detail
app.get('/api/pm2/app-detail/:name', authMiddleware, async (req, res) => {
  try {
    const { stdout } = await execAsync('pm2 jlist');
    const apps = JSON.parse(stdout || '[]');
    const app_data = apps.find(a => a.name === req.params.name);
    if (!app_data) return res.status(404).json({ error: 'App not found' });

    const env = app_data.pm2_env || {};
    res.json({
      name: app_data.name,
      pm_id: app_data.pm_id,
      monit: app_data.monit,
      status: env.status,
      exec_mode: env.exec_mode,
      instances: env.instances,
      pm_exec_path: env.pm_exec_path,
      pm_cwd: env.pm_cwd,
      pm_out_log_path: env.pm_out_log_path,
      pm_err_log_path: env.pm_err_log_path,
      created_at: env.created_at,
      restart_time: env.restart_time,
      pm_uptime: env.pm_uptime,
      node_version: env.node_version,
      versioning: env.versioning || null,
      watch: env.watch,
      autorestart: env.autorestart,
      max_memory_restart: env.max_memory_restart,
      cron_restart: env.cron_restart,
      args: env.args,
      node_args: env.node_args,
      interpreter: env.exec_interpreter,
      env_vars: env.env || {},
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Start with advanced options
app.post('/api/pm2/start-advanced', authMiddleware, async (req, res) => {
  const { script, name, cwd, exec_mode, instances, watch, watch_type, ignore_watch, watch_only,
    max_memory_restart, env, cron_restart, args, node_args, interpreter, autorestart } = req.body;
  if (!script || !name) return res.status(400).json({ error: 'script and name required' });

  try {
    // When watch is enabled, use ecosystem file for proper watch support
    if (watch) {
      const defaultIgnore = ['node_modules', '.git', '*.db', '*.db-journal', '*.db-wal', '*.sqlite', '*.sqlite3', '*.log', 'logs'];

      let watchValue, ignoreValue;

      if (watch_type === 'only' && watch_only) {
        // "Watch Only" mode: watch specific files/folders only
        const targets = Array.isArray(watch_only) ? watch_only : watch_only.split(',').map(s => s.trim()).filter(Boolean);
        watchValue = targets;
        ignoreValue = undefined; // not needed since we're being specific
      } else {
        // "Watch All" mode: watch everything, ignore patterns
        watchValue = true;
        const userIgnore = Array.isArray(ignore_watch) ? ignore_watch : (typeof ignore_watch === 'string' && ignore_watch.trim() ? ignore_watch.split(',').map(s => s.trim()).filter(Boolean) : []);
        ignoreValue = [...new Set([...defaultIgnore, ...userIgnore])];
      }

      const ecosystem = {
        apps: [{
          name,
          script,
          cwd: cwd || undefined,
          exec_mode: exec_mode === 'cluster' ? 'cluster' : 'fork',
          instances: exec_mode === 'cluster' ? (instances || 'max') : 1,
          watch: watchValue,
          ignore_watch: ignoreValue,
          max_memory_restart: max_memory_restart || undefined,
          cron_restart: cron_restart || undefined,
          node_args: node_args || undefined,
          interpreter: interpreter || 'node',
          autorestart: autorestart !== false,
          args: args || undefined,
          env: (env && Object.keys(env).length > 0) ? env : undefined,
        }]
      };

      const ecoPath = path.join(os.tmpdir(), `pm2-eco-${name}-${Date.now()}.json`);
      fs.writeFileSync(ecoPath, JSON.stringify(ecosystem, null, 2));
      await execAsync(`pm2 start ${ecoPath}`);
      try { fs.unlinkSync(ecoPath); } catch {}
    } else {
      let cmd = `pm2 start "${script}" --name "${name}"`;
      if (cwd) cmd += ` --cwd "${cwd}"`;
      if (exec_mode === 'cluster') {
        cmd += ' -i ' + (instances || 'max');
      }
      if (max_memory_restart) cmd += ` --max-memory-restart "${max_memory_restart}"`;
      if (cron_restart) cmd += ` --cron-restart "${cron_restart}"`;
      if (args) cmd += ` -- ${args}`;
      if (node_args) cmd += ` --node-args="${node_args}"`;
      if (interpreter) cmd += ` --interpreter "${interpreter}"`;
      if (autorestart === false) cmd += ' --no-autorestart';
      if (env && Object.keys(env).length > 0) {
        const envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ');
        cmd = envStr + ' ' + cmd;
      }
      await execAsync(cmd);
    }

    await execAsync('pm2 save');
    auditLog('pm2_start_advanced', req.ip, req.get('User-Agent'), { script, name, cwd, exec_mode });
    res.json({ success: true, message: `Started ${name}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Graceful reload
app.post('/api/pm2/reload', authMiddleware, async (req, res) => {
  const { name_or_id } = req.body;
  if (!name_or_id) return res.status(400).json({ error: 'name_or_id required' });
  try {
    await execAsync(`pm2 reload "${name_or_id}"`);
    auditLog('pm2_reload', req.ip, req.get('User-Agent'), { name_or_id });
    res.json({ success: true, message: `Reloaded ${name_or_id}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Flush logs
app.post('/api/pm2/flush', authMiddleware, async (req, res) => {
  const { name_or_id } = req.body;
  if (!name_or_id) return res.status(400).json({ error: 'name_or_id required' });
  try {
    await execAsync(`pm2 flush "${name_or_id}"`);
    auditLog('pm2_flush', req.ip, req.get('User-Agent'), { name_or_id });
    res.json({ success: true, message: `Flushed logs for ${name_or_id}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reset restart counters
app.post('/api/pm2/reset', authMiddleware, async (req, res) => {
  const { name_or_id } = req.body;
  if (!name_or_id) return res.status(400).json({ error: 'name_or_id required' });
  try {
    await execAsync(`pm2 reset "${name_or_id}"`);
    auditLog('pm2_reset', req.ip, req.get('User-Agent'), { name_or_id });
    res.json({ success: true, message: `Reset counters for ${name_or_id}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scale instances
app.post('/api/pm2/scale', authMiddleware, async (req, res) => {
  const { name, instances } = req.body;
  if (!name || instances === undefined) return res.status(400).json({ error: 'name and instances required' });
  try {
    await execAsync(`pm2 scale "${name}" ${instances}`);
    auditLog('pm2_scale', req.ip, req.get('User-Agent'), { name, instances });
    res.json({ success: true, message: `Scaled ${name} to ${instances}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PM2 save
app.post('/api/pm2/save', authMiddleware, async (req, res) => {
  try {
    const { stdout } = await execAsync('pm2 save');
    auditLog('pm2_save', req.ip, req.get('User-Agent'), {});
    res.json({ success: true, message: 'PM2 process list saved', output: stdout });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Boot persistence ─────────────────────────────────────────────────────
 *
 * "Will my app come back after a reboot?" is three separate questions, and
 * the old single `pm2 startup` button answered none of them honestly:
 *
 *   1. Is the PM2 daemon itself started at boot?
 *   2. Is the current process list saved to the dump file?
 *   3. Does this specific app have autorestart enabled? (crash recovery,
 *      NOT boot recovery — constantly confused with the other two)
 *
 * `pm2 startup` decides the init system by looking for binaries on PATH, so
 * inside a container it happily reports "Init System found: systemd" and
 * writes a unit that will never execute. It returns success. Nothing starts.
 *
 * We detect from PID 1 instead, and where systemd is genuinely unavailable
 * we offer an @reboot crontab entry, which does work under container inits.
 */

const PM2_BIN = 'pm2';

function pm2StartupUnitPath() {
  return `/etc/systemd/system/pm2-${platform.USER.name}.service`;
}

function cronBootLine() {
  // Explicit PM2_HOME: the daemon's home and the effective user's home can
  // differ under `sudo -E`, and resurrect reads the dump from PM2_HOME.
  return `@reboot PM2_HOME=${platform.PM2.home} ${process.execPath} $(command -v pm2 || echo /usr/lib/node_modules/pm2/bin/pm2) resurrect`;
}

async function readCrontab() {
  try {
    const { stdout } = await execAsync('crontab -l 2>/dev/null');
    return stdout;
  } catch { return ''; }
}

async function bootStatus() {
  const init = platform.INIT;
  const status = {
    init: init.kind,
    pid1: init.pid1,
    inContainer: init.inContainer,
    pm2Home: platform.PM2.home,
    pm2HomeSource: platform.PM2.homeSource,
    pm2HomeMismatch: platform.PM2.homeMismatch,
    expectedPm2Home: platform.PM2.expectedHome,
    daemonAtBoot: false,
    method: 'none',
    dumpExists: false,
    dumpSavedAt: null,
    savedApps: [],
    warnings: [],
    canConfigure: true,
  };

  // (2) The dump file — what resurrect will actually replay.
  try {
    const st = await fsp.stat(platform.PM2.dumpFile);
    status.dumpExists = true;
    status.dumpSavedAt = st.mtime.toISOString();
    const dump = JSON.parse(await fsp.readFile(platform.PM2.dumpFile, 'utf8'));
    status.savedApps = (Array.isArray(dump) ? dump : []).map(a => a.name).filter(Boolean);
  } catch { /* never saved */ }

  // (1) Is the daemon itself wired to start at boot?
  if (init.kind === 'systemd') {
    try {
      const { stdout } = await execAsync(`systemctl is-enabled pm2-${platform.USER.name}.service 2>&1`);
      if (stdout.trim() === 'enabled') { status.daemonAtBoot = true; status.method = 'systemd'; }
    } catch { /* not enabled */ }
  } else {
    const cron = await readCrontab();
    if (/pm2\b.*resurrect/.test(cron)) { status.daemonAtBoot = true; status.method = 'cron'; }

    if (init.kind === 'systemd-unavailable') {
      status.warnings.push(
        'systemd is installed but is not PID 1 on this host, so systemd units never run. ' +
        '`pm2 startup` will still claim success and write a unit that does nothing.'
      );
    } else if (init.inContainer) {
      status.warnings.push(
        `This host runs inside a container (PID 1 is \`${init.pid1}\`). There is no init system to ` +
        'start PM2 at boot; the container runtime restarts the container instead. Configure a ' +
        'restart policy there, or use the @reboot fallback if cron runs in this container.'
      );
    }
    if (!init.hasCron) {
      status.canConfigure = false;
      status.warnings.push('`crontab` is not installed, so the @reboot fallback is unavailable.');
    }
  }

  if (status.pm2HomeMismatch) {
    status.warnings.push(
      `The running PM2 daemon uses PM2_HOME=${platform.PM2.home}, but a generated startup unit ` +
      `would assume ${platform.PM2.expectedHome}. Resurrect would read the wrong dump file and ` +
      'start nothing. Boot config written here pins the daemon\'s actual PM2_HOME.'
    );
  }

  return status;
}

app.get('/api/pm2/boot-status', authMiddleware, async (req, res) => {
  try {
    res.json(await bootStatus());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enable or disable boot persistence, using whatever mechanism this host
// genuinely supports. Always saves the process list first: enabling boot
// start without a dump file produces an empty resurrect.
app.post('/api/pm2/boot-config', authMiddleware, async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' });

  const init = platform.INIT;
  try {
    if (enabled) {
      await execAsync('pm2 save');

      if (init.kind === 'systemd') {
        const { stdout } = await execAsync(
          `env PM2_HOME=${platform.PM2.home} pm2 startup systemd -u ${platform.USER.name} --hp ${platform.USER.home} 2>&1`
        );
        // pm2 prints a sudo command to run when it can't write the unit itself.
        const cmd = stdout.split('\n').find(l => l.trim().startsWith('sudo env'));
        if (cmd) { try { await execAsync(cmd.trim()); } catch { /* may already be applied */ } }
        await execAsync(`systemctl enable pm2-${platform.USER.name}.service`).catch(() => {});
      } else {
        if (!init.hasCron) {
          return res.status(400).json({
            error: 'No supported boot mechanism on this host: systemd is not PID 1 and crontab is not installed.',
          });
        }
        const cron = await readCrontab();
        const kept = cron.split('\n').filter(l => l.trim() && !/pm2\b.*resurrect/.test(l));
        kept.push(cronBootLine());
        const tmp = path.join(os.tmpdir(), `pm2-cron-${Date.now()}`);
        await fsp.writeFile(tmp, kept.join('\n') + '\n', { mode: 0o600 });
        await execAsync(`crontab ${tmp}`);
        await fsp.unlink(tmp).catch(() => {});
      }
    } else {
      if (init.kind === 'systemd') {
        await execAsync(`systemctl disable pm2-${platform.USER.name}.service`).catch(() => {});
        await execAsync(`pm2 unstartup systemd -u ${platform.USER.name} --hp ${platform.USER.home} 2>&1`).catch(() => {});
      } else if (init.hasCron) {
        const cron = await readCrontab();
        const kept = cron.split('\n').filter(l => l.trim() && !/pm2\b.*resurrect/.test(l));
        const tmp = path.join(os.tmpdir(), `pm2-cron-${Date.now()}`);
        await fsp.writeFile(tmp, kept.length ? kept.join('\n') + '\n' : '', { mode: 0o600 });
        await execAsync(`crontab ${tmp}`);
        await fsp.unlink(tmp).catch(() => {});
      }
    }

    auditLog('pm2_boot_config', req.ip, req.get('User-Agent'), { enabled, init: init.kind });
    res.json({ success: true, status: await bootStatus() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Legacy endpoint kept so nothing 404s, but it no longer pretends.
app.post('/api/pm2/startup', authMiddleware, async (req, res) => {
  try {
    const status = await bootStatus();
    if (platform.INIT.kind !== 'systemd') {
      return res.json({
        success: false,
        message: 'systemd is not the init system on this host; `pm2 startup` would report success without doing anything. Use boot persistence instead.',
        status,
      });
    }
    const { stdout } = await execAsync('pm2 startup 2>&1');
    auditLog('pm2_startup', req.ip, req.get('User-Agent'), {});
    res.json({ success: true, message: 'PM2 startup configured', output: stdout, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PM2 resurrect
app.post('/api/pm2/resurrect', authMiddleware, async (req, res) => {
  try {
    const { stdout } = await execAsync('pm2 resurrect 2>&1');
    auditLog('pm2_resurrect', req.ip, req.get('User-Agent'), {});
    res.json({ success: true, message: 'PM2 process list restored', output: stdout });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PM2 monit - CPU/memory snapshot
app.get('/api/pm2/monit/:name', authMiddleware, async (req, res) => {
  try {
    const { stdout } = await execAsync('pm2 jlist');
    const apps = JSON.parse(stdout || '[]');
    const app_data = apps.find(a => a.name === req.params.name);
    if (!app_data) return res.status(404).json({ error: 'App not found' });

    res.json({
      name: app_data.name,
      cpu: app_data.monit?.cpu || 0,
      memory: app_data.monit?.memory || 0,
      timestamp: Date.now()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Git Management ───
const GIT_SYNC_CONFIG = path.join(__dirname, '..', 'git-sync-config.json');

// SSH identity and HOME resolved at boot by platform.cjs. Hard-coding
// /home/ubuntu meant git ran as a stranger on any other host: no user.name,
// no key, every push failing with a useless auth error.
function gitExec(cwd, cmd) {
  // Use array form to avoid shell interpretation of special characters like |
  const args = cmd.match(/"[^"]*"|'[^']*'|\S+/g).map(a => a.replace(/^["']|["']$/g, ''));
  return require('child_process').execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30000, env: platform.gitEnv() }).trim();
}

function loadGitSyncConfig() {
  try { return JSON.parse(fs.readFileSync(GIT_SYNC_CONFIG, 'utf8')); } catch { return { repos: {} }; }
}

function saveGitSyncConfig(config) {
  fs.writeFileSync(GIT_SYNC_CONFIG, JSON.stringify(config, null, 2));
}

app.get('/api/git/repos', authMiddleware, (req, res) => {
  const searchPath = validatePath(req.query.searchPath || platform.DEFAULT_PATH);
  if (!searchPath) return res.status(400).json({ error: 'Invalid search path' });
  try {
    // execFile with an argument array: a path containing shell metacharacters
    // can no longer break out of the command.
    const output = require('child_process').execFileSync(
      'find', [searchPath, '-maxdepth', '3', '-name', '.git', '-type', 'd'],
      { encoding: 'utf8', timeout: 10000 }
    );
    const repos = output.trim().split('\n').filter(Boolean).map(p => {
      const rp = path.dirname(p);
      try {
        const branch = gitExec(rp, 'branch --show-current');
        let remote = '';
        try { remote = gitExec(rp, 'remote get-url origin'); } catch { remote = ''; }
        return { path: rp, branch, remote };
      } catch { return { path: rp, branch: '?', remote: '?' }; }
    });
    res.json({ repos });
  } catch { res.json({ repos: [] }); }
});

app.get('/api/git/info', authMiddleware, (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const branch = gitExec(repo, 'branch --show-current');
    const branches = gitExec(repo, 'branch -a').split('\n').map(b => b.trim().replace(/^\* /, ''));
    const remote = gitExec(repo, 'remote -v').split('\n').filter(l => l.includes('(push)')).map(l => { const p = l.split(/\s+/); return { name: p[0], url: p[1] }; });
    const lc = gitExec(repo, 'log -1 --format=%H%x09%s%x09%an%x09%ar').split('\t');
    res.json({ branch, branches, remotes: remote, lastCommit: { hash: lc[0], message: lc[1], author: lc[2], time: lc[3] } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/status', authMiddleware, (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const raw = gitExec(repo, 'status --porcelain');
    const files = raw ? raw.split('\n').map(l => ({ status: l.substring(0, 2).trim(), file: l.substring(3) })) : [];
    let ahead = 0, behind = 0;
    try { ahead = parseInt(gitExec(repo, 'rev-list @{u}..HEAD --count')); } catch {}
    try { behind = parseInt(gitExec(repo, 'rev-list HEAD..@{u} --count')); } catch {}
    res.json({ files, ahead, behind });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/log', authMiddleware, (req, res) => {
  const { repo, limit = 20 } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const raw = gitExec(repo, `log --oneline -${limit} --format=%H%x09%s%x09%an%x09%ar`);
    const commits = raw ? raw.split('\n').filter(l => l).map(l => { const [hash, message, author, time] = l.split('\t'); return { hash, message, author, time }; }) : [];
    res.json({ commits });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/diff', authMiddleware, (req, res) => {
  const { repo, file } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const diff = file ? gitExec(repo, `diff -- "${file}"`) : gitExec(repo, 'diff');
    res.json({ diff: diff || 'No changes' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/stage', authMiddleware, (req, res) => {
  const { repo, files } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    if (!files || !files.length || (files.length === 1 && files[0] === '.')) { gitExec(repo, 'add -A'); }
    else { files.forEach(f => gitExec(repo, `add "${f}"`)); }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/commit', authMiddleware, (req, res) => {
  const { repo, message } = req.body;
  if (!repo || !message) return res.status(400).json({ error: 'repo and message required' });
  try {
    gitExec(repo, `commit -m "${message.replace(/"/g, '\\"')}"`);
    auditLog('git_commit', req.ip, req.get('User-Agent'), { repo, message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/pull', authMiddleware, async (req, res) => {
  const { repo, remote = 'origin', branch } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const br = branch || gitExec(repo, 'branch --show-current');
    const output = gitExec(repo, `pull ${remote} ${br} --no-edit`);
    auditLog('git_pull', req.ip, req.get('User-Agent'), { repo });
    
    // Smart restart: check if any PM2 app runs from this repo
    const restarted = await smartRestartForPath(path.join(repo, 'dummy'));
    
    // Also check git-sync config for linked pm2App
    try {
      const syncConfig = loadGitSyncConfig();
      const repoConf = syncConfig.repos[repo];
      if (repoConf && repoConf.pm2App && !restarted.includes(repoConf.pm2App)) {
        const ok = await restartPm2App(repoConf.pm2App);
        if (ok) restarted.push(repoConf.pm2App);
      }
    } catch {}
    
    res.json({ success: true, output, restarted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/push', authMiddleware, (req, res) => {
  const { repo, remote = 'origin', branch, force = false } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const br = branch || gitExec(repo, 'branch --show-current');
    const output = gitExec(repo, `push ${remote} ${br} ${force ? '--force' : ''}`);
    auditLog('git_push', req.ip, req.get('User-Agent'), { repo, force });
    res.json({ success: true, output });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/checkout', authMiddleware, (req, res) => {
  const { repo, branch } = req.body;
  if (!repo || !branch) return res.status(400).json({ error: 'repo and branch required' });
  try { gitExec(repo, `checkout ${branch}`); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/discard', authMiddleware, (req, res) => {
  const { repo, file } = req.body;
  if (!repo || !file) return res.status(400).json({ error: 'repo and file required' });
  try { gitExec(repo, `checkout -- "${file}"`); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Auto-sync config
app.get('/api/git/sync/config', authMiddleware, (req, res) => { res.json(loadGitSyncConfig()); });

app.post('/api/git/sync/config', authMiddleware, (req, res) => {
  const { repo, enabled, intervalSeconds = 30, autoPush = true, autoPull = true, autoResolveConflicts = true, commitMessage = 'auto-sync: {timestamp}', pm2App } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  const config = loadGitSyncConfig();
  config.repos[repo] = { enabled, intervalSeconds, autoPush, autoPull, autoResolveConflicts, commitMessage, pm2App: pm2App || undefined };
  saveGitSyncConfig(config);
  try { execSync('kill -USR1 $(cat /tmp/git-sync-daemon.pid) 2>/dev/null'); } catch {}
  res.json({ success: true, config: config.repos[repo] });
});

app.delete('/api/git/sync/config', authMiddleware, (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  const config = loadGitSyncConfig();
  delete config.repos[repo];
  saveGitSyncConfig(config);
  try { execSync('kill -USR1 $(cat /tmp/git-sync-daemon.pid) 2>/dev/null'); } catch {}
  res.json({ success: true });
});

// ─── STASH ENDPOINTS ───
app.post('/api/git/stash', authMiddleware, (req, res) => {
  const { repo, message = 'WIP' } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const status = gitExec(repo, 'status --porcelain');
    if (!status || !status.trim()) {
      return res.json({ success: true, stashed: false, message: 'No changes to stash' });
    }
    gitExec(repo, `stash push -m "${message.replace(/"/g, '\\"')}"`);
    auditLog('git_stash', req.ip, req.get('User-Agent'), { repo, message });
    res.json({ success: true, stashed: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/stash/pop', authMiddleware, (req, res) => {
  const { repo, stashRef } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const cmd = stashRef ? `stash pop ${stashRef}` : 'stash pop';
    const output = gitExec(repo, cmd);
    auditLog('git_stash_pop', req.ip, req.get('User-Agent'), { repo, stashRef });
    res.json({ success: true, output });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/stash/list', authMiddleware, (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const raw = gitExec(repo, 'stash list --format=%gd%x09%gs');
    const stashes = raw ? raw.split('\n').filter(l => l).map(l => {
      const parts = l.split('\t');
      return { ref: parts[0], message: parts[1] || 'No message' };
    }) : [];
    res.json({ stashes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── BRANCH MANAGEMENT ENDPOINTS ───
app.post('/api/git/branch/create', authMiddleware, (req, res) => {
  const { repo, name } = req.body;
  if (!repo || !name) return res.status(400).json({ error: 'repo and name required' });
  try {
    gitExec(repo, `checkout -b ${name}`);
    auditLog('git_branch_create', req.ip, req.get('User-Agent'), { repo, name });
    res.json({ success: true, branch: name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/branch/delete', authMiddleware, (req, res) => {
  const { repo, name } = req.body;
  if (!repo || !name) return res.status(400).json({ error: 'repo and name required' });
  try {
    gitExec(repo, `branch -D ${name}`);
    auditLog('git_branch_delete', req.ip, req.get('User-Agent'), { repo, name });
    res.json({ success: true, branch: name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/branch/checkout', authMiddleware, (req, res) => {
  const { repo, name } = req.body;
  if (!repo || !name) return res.status(400).json({ error: 'repo and name required' });
  try {
    gitExec(repo, `checkout ${name}`);
    auditLog('git_branch_checkout', req.ip, req.get('User-Agent'), { repo, name });
    res.json({ success: true, branch: name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/branches', authMiddleware, (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const raw = gitExec(repo, 'branch -a');
    const branches = raw.split('\n').filter(l => l).map(b => {
      const isCurrent = b.startsWith('*');
      const name = b.replace(/^\*?\s+/, '').trim().replace('remotes/origin/', '');
      return { name, isCurrent, isRemote: b.includes('remotes/') };
    }).filter(b => !b.isRemote);
    res.json({ branches });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── TAG MANAGEMENT ENDPOINTS ───
app.post('/api/git/tag/create', authMiddleware, (req, res) => {
  const { repo, name, message = '' } = req.body;
  if (!repo || !name) return res.status(400).json({ error: 'repo and name required' });
  try {
    const cmd = message ? `tag -a ${name} -m "${message.replace(/"/g, '\\"')}"` : `tag ${name}`;
    gitExec(repo, cmd);
    auditLog('git_tag_create', req.ip, req.get('User-Agent'), { repo, name, message });
    res.json({ success: true, tag: name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/git/tag', authMiddleware, (req, res) => {
  const { repo, name } = req.body;
  if (!repo || !name) return res.status(400).json({ error: 'repo and name required' });
  try {
    gitExec(repo, `tag -d ${name}`);
    auditLog('git_tag_delete', req.ip, req.get('User-Agent'), { repo, name });
    res.json({ success: true, tag: name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/tags', authMiddleware, (req, res) => {
  const { repo, limit = 50 } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const raw = gitExec(repo, `tag -l -n${limit} --format=%(refname:short)%00%(contents:subject)`);
    const tags = raw ? raw.split('\n').filter(l => l).map(l => {
      const parts = l.split('\0');
      return { name: parts[0], message: parts[1] || '' };
    }) : [];
    res.json({ tags });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── MERGE ENDPOINTS ───
app.post('/api/git/merge', authMiddleware, (req, res) => {
  const { repo, branch } = req.body;
  if (!repo || !branch) return res.status(400).json({ error: 'repo and branch required' });
  try {
    const output = gitExec(repo, `merge ${branch}`);
    auditLog('git_merge', req.ip, req.get('User-Agent'), { repo, branch });
    res.json({ success: true, output });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/merge/abort', authMiddleware, (req, res) => {
  const { repo } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    gitExec(repo, 'merge --abort');
    auditLog('git_merge_abort', req.ip, req.get('User-Agent'), { repo });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/merge/status', authMiddleware, (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const status = gitExec(repo, 'status --porcelain');
    const hasConflicts = status && (status.includes('UU') || status.includes('AA') || status.includes('DD'));
    const conflictedFiles = hasConflicts
      ? status.split('\n')
          .filter(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD'))
          .map(l => l.substring(3).trim())
      : [];
    res.json({ hasConflicts, conflictedFiles });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/sync/status', authMiddleware, (req, res) => {
  let running = false;
  let pid = null;
  try {
    pid = fs.readFileSync('/tmp/git-sync-daemon.pid', 'utf8').trim();
    execSync(`kill -0 ${pid}`);
    running = true;
  } catch {
    // Daemon not running — try to auto-start it
    try {
      execSync('systemctl start git-sync-daemon 2>/dev/null || (cd "' + path.join(__dirname, '..') + '" && nohup node git-sync-daemon.cjs >> /tmp/git-sync-daemon.log 2>&1 &)', { timeout: 5000 });
    } catch {}
    // Re-check after start attempt
    try {
      pid = fs.readFileSync('/tmp/git-sync-daemon.pid', 'utf8').trim();
      execSync(`kill -0 ${pid}`);
      running = true;
    } catch { pid = null; }
  }
  let logs = '';
  try { logs = fs.readFileSync('/tmp/git-sync-daemon.log', 'utf8').split('\n').slice(-50).join('\n'); } catch {}
  res.json({ running, pid: pid ? parseInt(pid) : null, logs });
});

// ─── GitHub Setup Routes ───

app.get('/api/git/github/status', authMiddleware, (req, res) => {
  try {
    const status = {
      configured: false,
      gitUser: { name: null, email: null },
      sshKey: { exists: false, type: null, publicKey: null },
      github: { connected: false, username: null }
    };
    try { status.gitUser.name = execSync('git config --global user.name', { encoding: 'utf8' }).trim(); } catch {}
    try { status.gitUser.email = execSync('git config --global user.email', { encoding: 'utf8' }).trim(); } catch {}
    const homeDir = require('os').homedir();
    const keyPaths = [path.join(homeDir, '.ssh', 'id_ed25519'), path.join(homeDir, '.ssh', 'id_rsa')];
    for (const kp of keyPaths) {
      if (fs.existsSync(kp)) {
        status.sshKey.exists = true;
        status.sshKey.type = kp.includes('ed25519') ? 'ed25519' : 'rsa';
        try { const pub = kp + '.pub'; if (fs.existsSync(pub)) status.sshKey.publicKey = fs.readFileSync(pub, 'utf8').trim(); } catch {}
        break;
      }
    }
    if (status.sshKey.exists) {
      try {
        const output = execSync('ssh -T git@github.com -o StrictHostKeyChecking=no -o ConnectTimeout=5 2>&1', { encoding: 'utf8', timeout: 10000 });
        if (output.includes('successfully authenticated')) { status.github.connected = true; const m = output.match(/Hi ([^!]+)!/); if (m) status.github.username = m[1]; }
      } catch (e) {
        const output = (e.stdout || '') + (e.stderr || '');
        if (output.includes('successfully authenticated')) { status.github.connected = true; const m = output.match(/Hi ([^!]+)!/); if (m) status.github.username = m[1]; }
      }
    }
    status.configured = !!(status.gitUser.name && status.gitUser.email && status.sshKey.exists && status.github.connected);
    res.json(status);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/github/setup', authMiddleware, (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });
  try {
    execSync(`git config --global user.name "${name.replace(/"/g, '\\"')}"`, { timeout: 10000 });
    execSync(`git config --global user.email "${email.replace(/"/g, '\\"')}"`, { timeout: 10000 });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/github/generate-key', authMiddleware, (req, res) => {
  const { email, force = false } = req.body;
  try {
    const homeDir = require('os').homedir();
    const sshDir = path.join(homeDir, '.ssh');
    const keyPath = path.join(sshDir, 'id_ed25519');
    if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { mode: 0o700 });
    if (fs.existsSync(keyPath) && !force) return res.status(400).json({ error: 'SSH key already exists. Use force to overwrite.' });
    let keyEmail = email;
    if (!keyEmail) try { keyEmail = execSync('git config --global user.email', { encoding: 'utf8' }).trim(); } catch {}
    if (!keyEmail) return res.status(400).json({ error: 'Email required' });
    if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
    if (fs.existsSync(keyPath + '.pub')) fs.unlinkSync(keyPath + '.pub');
    execSync(`ssh-keygen -t ed25519 -C "${keyEmail}" -f "${keyPath}" -N ""`, { timeout: 30000 });
    const publicKey = fs.readFileSync(keyPath + '.pub', 'utf8').trim();
    res.json({ success: true, publicKey });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/github/public-key', authMiddleware, (req, res) => {
  try {
    const homeDir = require('os').homedir();
    const keyPaths = [path.join(homeDir, '.ssh', 'id_ed25519.pub'), path.join(homeDir, '.ssh', 'id_rsa.pub')];
    for (const kp of keyPaths) {
      if (fs.existsSync(kp)) return res.json({ success: true, publicKey: fs.readFileSync(kp, 'utf8').trim() });
    }
    res.status(404).json({ error: 'No SSH public key found' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/github/test-connection', authMiddleware, (req, res) => {
  try {
    const output = execSync('ssh -T git@github.com -o StrictHostKeyChecking=no -o ConnectTimeout=10 2>&1', { encoding: 'utf8', timeout: 15000 });
    let connected = false, username = null;
    if (output.includes('successfully authenticated')) { connected = true; const m = output.match(/Hi ([^!]+)!/); if (m) username = m[1]; }
    res.json({ connected, username });
  } catch (e) {
    const output = (e.stdout || '') + (e.stderr || '');
    let connected = false, username = null;
    if (output.includes('successfully authenticated')) { connected = true; const m = output.match(/Hi ([^!]+)!/); if (m) username = m[1]; }
    res.json({ connected, username, error: connected ? null : (output || e.message) });
  }
});

app.post('/api/git/github/disconnect', authMiddleware, (req, res) => {
  try {
    const homeDir = require('os').homedir();
    for (const k of ['id_ed25519', 'id_rsa']) {
      const kp = path.join(homeDir, '.ssh', k);
      if (fs.existsSync(kp)) fs.unlinkSync(kp);
      if (fs.existsSync(kp + '.pub')) fs.unlinkSync(kp + '.pub');
    }
    try { execSync('git config --global --unset user.name', { timeout: 10000 }); } catch {}
    try { execSync('git config --global --unset user.email', { timeout: 10000 }); } catch {}
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/github/clone', authMiddleware, (req, res) => {
  const { url, path: clonePath, branch } = req.body;
  if (!url || !clonePath) return res.status(400).json({ error: 'url and path required' });
  try {
    const parentDir = path.dirname(clonePath);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    const cmd = branch ? `git clone -b ${branch} "${url}" "${clonePath}"` : `git clone "${url}" "${clonePath}"`;
    execSync(cmd, { timeout: 120000 });
    auditLog('git_clone', req.ip, req.get('User-Agent'), { url, clonePath, branch });
    // Do NOT auto-enable sync - user must explicitly enable it
    res.json({ success: true, message: 'Repository cloned. Enable auto-sync in Settings tab.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Git Stash Endpoints ───
app.post('/api/git/stash', authMiddleware, (req, res) => {
  const { repo, message = 'WIP' } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const status = gitExec(repo, 'status --porcelain');
    if (!status) { return res.json({ success: true, stashed: false, message: 'No changes to stash' }); }
    gitExec(repo, `stash push -m "${message.replace(/"/g, '\\"')}"`);
    auditLog('git_stash', req.ip, req.get('User-Agent'), { repo, message });
    res.json({ success: true, stashed: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/stash/pop', authMiddleware, (req, res) => {
  const { repo } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    gitExec(repo, 'stash pop');
    auditLog('git_stash_pop', req.ip, req.get('User-Agent'), { repo });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/stash/list', authMiddleware, (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const raw = gitExec(repo, 'stash list --format=%gd%x09%gs');
    const stashes = raw ? raw.split('\n').filter(l => l).map(l => {
      const [ref, message] = l.split('\t');
      return { ref, message };
    }) : [];
    res.json({ stashes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Git Branch Management ───
app.post('/api/git/branch/create', authMiddleware, (req, res) => {
  const { repo, name } = req.body;
  if (!repo || !name) return res.status(400).json({ error: 'repo and name required' });
  try {
    gitExec(repo, `checkout -b ${name}`);
    auditLog('git_branch_create', req.ip, req.get('User-Agent'), { repo, name });
    res.json({ success: true, branch: name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/branch/delete', authMiddleware, (req, res) => {
  const { repo, name } = req.body;
  if (!repo || !name) return res.status(400).json({ error: 'repo and name required' });
  try {
    gitExec(repo, `branch -D ${name}`);
    auditLog('git_branch_delete', req.ip, req.get('User-Agent'), { repo, name });
    res.json({ success: true, branch: name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/branch/checkout', authMiddleware, (req, res) => {
  const { repo, branch } = req.body;
  if (!repo || !branch) return res.status(400).json({ error: 'repo and branch required' });
  try {
    gitExec(repo, `checkout ${branch}`);
    auditLog('git_branch_checkout', req.ip, req.get('User-Agent'), { repo, branch });
    res.json({ success: true, branch });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/branches', authMiddleware, (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const raw = gitExec(repo, 'branch -a');
    const currentRaw = gitExec(repo, 'branch --show-current');
    const current = currentRaw.trim();
    const branches = raw.split('\n').filter(l => l).map(b => {
      const isCurrent = b.startsWith('*');
      const name = b.replace(/^\*?\s+/, '').trim().replace('remotes/origin/', '');
      return { name, isCurrent, isRemote: b.includes('remotes/') };
    }).filter(b => !b.isRemote);
    res.json({ branches, current });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Git Tag Management ───
app.post('/api/git/tag/create', authMiddleware, (req, res) => {
  const { repo, name, message = '' } = req.body;
  if (!repo || !name) return res.status(400).json({ error: 'repo and name required' });
  try {
    const cmd = message ? `tag -a ${name} -m "${message.replace(/"/g, '\\"')}"` : `tag ${name}`;
    gitExec(repo, cmd);
    auditLog('git_tag_create', req.ip, req.get('User-Agent'), { repo, name, message });
    res.json({ success: true, tag: name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/git/tag', authMiddleware, (req, res) => {
  const { repo, name } = req.body;
  if (!repo || !name) return res.status(400).json({ error: 'repo and name required' });
  try {
    gitExec(repo, `tag -d ${name}`);
    auditLog('git_tag_delete', req.ip, req.get('User-Agent'), { repo, name });
    res.json({ success: true, tag: name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/tags', authMiddleware, (req, res) => {
  const { repo, limit = 50 } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const raw = gitExec(repo, `tag -l -n${limit} --format=%(refname:short)%00%(contents:subject)`);
    const tags = raw ? raw.split('\n').filter(l => l).map(l => {
      const [name, message] = l.split('\0');
      return { name, message: message || '' };
    }) : [];
    res.json({ tags });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Git Merge & Conflict Resolution ───
app.post('/api/git/merge', authMiddleware, (req, res) => {
  const { repo, branch } = req.body;
  if (!repo || !branch) return res.status(400).json({ error: 'repo and branch required' });
  try {
    gitExec(repo, `merge ${branch}`);
    auditLog('git_merge', req.ip, req.get('User-Agent'), { repo, branch });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/git/merge/abort', authMiddleware, (req, res) => {
  const { repo } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    gitExec(repo, 'merge --abort');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/git/merge/status', authMiddleware, (req, res) => {
  const { repo } = req.query;
  if (!repo) return res.status(400).json({ error: 'repo required' });
  try {
    const status = gitExec(repo, 'status --porcelain');
    const hasConflicts = status && (status.includes('UU') || status.includes('AA') || status.includes('DD'));
    const conflictedFiles = hasConflicts
      ? status.split('\n')
          .filter(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD'))
          .map(l => l.substring(3).trim())
      : [];
    res.json({ hasConflicts, conflictedFiles });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Socket.IO Setup ───
const io = new Server(server, { 
  cors: { origin: '*', methods: ['GET', 'POST'] } 
});

// ─── Terminal sessions via Socket.IO ───
const terminals = new Map();
// PM2 live log processes (per-socket tracking for cleanup)
const pm2LogProcesses = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  const decoded = verifyToken(token);
  if (!decoded) return next(new Error('Invalid token'));
  socket.user = decoded;
  next();
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // Terminal
  socket.on('terminal:create', (data, cb) => {
    try {
      // os.homedir() reads $HOME, and the panel is launched with `sudo -n -E`,
      // which *preserves* the invoking user's HOME. Running as uid 0 that
      // yielded HOME=/home/ubuntu, so shells opened in /home/ubuntu while the
      // file manager (which uses real paths) wrote to /root — same `~` in the
      // prompt, two different directories. os.userInfo() reads the passwd
      // entry for the effective uid, which is the actual home.
      let defaultCwd;
      try { defaultCwd = os.userInfo().homedir || os.homedir(); }
      catch { defaultCwd = os.homedir(); }
      const { cols = 80, rows = 24, cwd = defaultCwd } = data || {};
      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      // The PTY must NOT inherit the panel's own environment wholesale.
      //
      // Two problems with `{ ...process.env }`:
      //  1. Secrets leak. PASSWORD and JWT_SECRET were readable from every
      //     shell, and by anything the user ran inside one.
      //  2. PORT collides. The panel's PORT=48292 was inherited, so a user's
      //     `app.listen(process.env.PORT || 3000)` bound to the panel's port,
      //     hit EADDRINUSE and exited instantly — looking like the script
      //     "didn't run" when it was really a port conflict.
      //
      // Strip the panel's config and hand the shell a normal login env.
      const shellEnv = { ...process.env };
      for (const k of ['PASSWORD', 'JWT_SECRET', 'PORT', 'SESSION_SECRET', 'TOKEN']) {
        delete shellEnv[k];
      }
      shellEnv.TERM = 'xterm-256color';
      shellEnv.HOME = defaultCwd; // `sudo -E` preserved the invoker's HOME
      try { shellEnv.USER = shellEnv.LOGNAME = os.userInfo().username; } catch { /* keep inherited */ }

      const ptyProc = pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd, env: shellEnv });
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      terminals.set(id, { pty: ptyProc, socketId: socket.id });
      ptyProc.on('data', d => socket.emit('terminal:data', { terminalId: id, data: d }));
      ptyProc.on('exit', (code) => { socket.emit('terminal:exit', { terminalId: id, code }); terminals.delete(id); });
      if (cb) cb({ success: true, terminalId: id });
    } catch (e) { if (cb) cb({ success: false, error: e.message }); }
  });

  socket.on('terminal:input', ({ terminalId, input }) => {
    const t = terminals.get(terminalId);
    if (t && t.socketId === socket.id) t.pty.write(input);
  });

  socket.on('terminal:resize', ({ terminalId, cols, rows }) => {
    const t = terminals.get(terminalId);
    if (t && t.socketId === socket.id) t.pty.resize(cols, rows);
  });

  socket.on('terminal:destroy', ({ terminalId }) => {
    const t = terminals.get(terminalId);
    if (t && t.socketId === socket.id) { t.pty.kill(); terminals.delete(terminalId); }
  });

  // Real-time stats subscription
  socket.on('stats:subscribe', () => socket.join('stats'));
  socket.on('stats:unsubscribe', () => socket.leave('stats'));

  // PM2 live logs
  socket.on('pm2:logs:subscribe', ({ name }) => {
    if (pm2LogProcesses.has(name)) return;
    try {
      const child = require('child_process').spawn('pm2', ['logs', name, '--raw', '--lines', '50'], { stdio: ['ignore', 'pipe', 'pipe'] });
      pm2LogProcesses.set(name, child);
      child.stdout.on('data', d => socket.emit('pm2:logs:data', { name, data: d.toString(), stream: 'out' }));
      child.stderr.on('data', d => socket.emit('pm2:logs:data', { name, data: d.toString(), stream: 'err' }));
      child.on('close', () => pm2LogProcesses.delete(name));
    } catch {}
  });

  socket.on('pm2:logs:unsubscribe', ({ name }) => {
    const child = pm2LogProcesses.get(name);
    if (child) { child.kill(); pm2LogProcesses.delete(name); }
  });

  socket.on('disconnect', () => {
    // Cleanup terminals
    for (const [id, t] of terminals) {
      if (t.socketId === socket.id) { t.pty.kill(); terminals.delete(id); }
    }
    // Cleanup pm2 log streams
    for (const [, child] of pm2LogProcesses) { child.kill(); }
    pm2LogProcesses.clear();
  });
});

// Broadcast system stats every 2s
setInterval(async () => {
  if (!io.sockets.adapter.rooms.has('stats')) return;
  try {
    let cpuUsage = 0;
    try {
      const { stdout } = await execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1");
      cpuUsage = parseFloat(stdout.trim()) || 0;
    } catch {}
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    let disk = null;
    try {
      const { stdout } = await execAsync("df -B1 / | tail -1 | awk '{print $2,$3,$4,$5}'");
      const [total, used, avail, pct] = stdout.trim().split(' ');
      disk = { total: parseInt(total), used: parseInt(used), available: parseInt(avail), percentage: parseFloat(pct) };
    } catch {}

    let network = { rx: 0, tx: 0 };
    try {
      const { stdout } = await execAsync("cat /proc/net/dev | grep -v lo | grep ':' | awk '{rx+=$2; tx+=$10} END {print rx, tx}'");
      const [rx, tx] = stdout.trim().split(' ');
      network = { rx: parseInt(rx), tx: parseInt(tx) };
    } catch {}

    io.to('stats').emit('stats:update', {
      cpu: cpuUsage, memory: { total: totalMem, used: usedMem, free: freeMem, percentage: (usedMem / totalMem) * 100 },
      disk, network, loadAvg: os.loadavg(), timestamp: Date.now()
    });
  } catch {}
}, 2000);

// ─── Health Check Endpoint ───
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      external: Math.round(process.memoryUsage().external / 1024 / 1024),
    },
    activeTerminals: terminals.size,
    activeLogSubscriptions: pm2LogProcesses.size,
    statsSubscribers: io.sockets.adapter.rooms.get('stats')?.size || 0,
  });
});

// ─── Self-update (detection only; applying lives in scripts/updater.mjs) ───
// Deliberately separate from GitSync: no git, no SSH, no remote. Anonymous
// HTTPS to the GitHub Releases API, so it works on any Linux VPS with
// outbound 443 and nothing else.

app.get('/api/update/check', authMiddleware, async (req, res) => {
  try {
    const result = await updater.check({ force: req.query.force === '1' });
    res.json({ ...result, notify: updater.shouldNotify(result), config: updater.loadConfig() });
  } catch (e) {
    res.status(503).json({ error: e.message, code: e.code || 'CHECK_FAILED' });
  }
});

app.get('/api/update/config', authMiddleware, (req, res) => {
  res.json(updater.loadConfig());
});

app.post('/api/update/config', authMiddleware, (req, res) => {
  const allowed = ['enabled', 'channel', 'checkIntervalHours', 'autoInstall', 'autoInstallWindow'];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  if (patch.channel && !['stable', 'beta'].includes(patch.channel)) {
    return res.status(400).json({ error: 'channel must be stable or beta' });
  }
  if (patch.checkIntervalHours !== undefined) {
    const n = Number(patch.checkIntervalHours);
    if (!Number.isFinite(n) || n < 1 || n > 168) {
      return res.status(400).json({ error: 'checkIntervalHours must be 1-168' });
    }
    patch.checkIntervalHours = n;
  }
  res.json(updater.saveConfig(patch));
});

// Snooze: server-side on purpose, so dismissing on a phone is honoured on desktop.
app.post('/api/update/snooze', authMiddleware, (req, res) => {
  const DURATIONS = { '1h': 3600e3, '1d': 86400e3, '1w': 604800e3 };
  const ms = DURATIONS[req.body?.duration];
  if (!ms) return res.status(400).json({ error: 'duration must be 1h, 1d or 1w' });
  res.json(updater.saveConfig({ snoozedUntil: Date.now() + ms }));
});

app.post('/api/update/skip', authMiddleware, (req, res) => {
  const version = req.body?.version;
  if (!version) return res.status(400).json({ error: 'version required' });
  res.json(updater.saveConfig({ skippedVersion: String(version) }));
});

app.post('/api/update/reset-dismissals', authMiddleware, (req, res) => {
  res.json(updater.saveConfig({ snoozedUntil: null, skippedVersion: null }));
});

// Captured once at boot, not read per request. The updater's health check
// compares this against the version it installed, and reading package.json
// live would make a stale process report the NEW version the moment files are
// swapped — turning a failed restart into a false success.
const BOOT_VERSION = updater.currentVersion();
const BOOT_ID = crypto.randomBytes(8).toString('hex');

// Unauthenticated on purpose: the post-update health probe needs to confirm the
// new build is answering before the old release directory is pruned.
app.get('/api/version', (req, res) => {
  res.json({ version: BOOT_VERSION, bootId: BOOT_ID, pid: process.pid, ok: true });
});

// ─── Applying an update ───
// The runner is copied to a temp dir and detached, because it overwrites the
// very tree this process is executing from. The request returns immediately;
// the browser follows progress via /api/update/status across the restart that
// necessarily kills its own connection.

app.post('/api/update/apply', authMiddleware, async (req, res) => {
  try {
    const running = updater.readStatus();
    if (running?.running) return res.status(409).json({ error: 'An update is already running' });

    const check = await updater.check({ force: true });
    if (!check.updateAvailable || !check.tarballUrl || !check.latestTag) {
      return res.status(400).json({ error: 'No update available to install' });
    }

    const started = updater.startUpdate({ tag: check.latestTag, tarballUrl: check.tarballUrl });
    auditLog('update_apply', req.ip, req.get('User-Agent'), {
      from: check.currentVersion, to: check.latestVersion,
    });
    res.json({ started: true, ...started });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Unauthenticated on purpose: this is how the browser confirms the panel came
// back after a restart, at which point it may have no valid token in hand.
app.get('/api/update/status', (req, res) => {
  res.json(updater.readStatus() || { running: false, ok: null, step: null });
});

// Dismiss a finished run's record. A past failure is history; leaving it on
// screen with no way to clear it makes a healthy panel look broken.
app.post('/api/update/status/clear', authMiddleware, (req, res) => {
  const r = updater.clearStatus();
  if (!r.cleared) return res.status(409).json({ error: r.reason });
  res.json(r);
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  for (const [, t] of terminals) t.pty.kill();
  server.close(() => process.exit(0));
});

server.listen(PORT, () => {
  console.log(`VPS Manager V3.1 running on port ${PORT}`);
  updater.startBackgroundChecks();
});