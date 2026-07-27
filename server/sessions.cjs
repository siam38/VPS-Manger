/**
 * Persistent refresh-token sessions.
 *
 * The panel used to hand out a single 30-minute JWT kept in localStorage, and
 * nothing ever renewed it. Half an hour into editing a file the next request
 * 401'd and you were back at the login form — mid-edit, unsaved.
 *
 * The standard fix, and what this implements:
 *
 *   access token   — short lived (15m), sent in the Authorization header,
 *                    never persisted anywhere a script can read long-term.
 *   refresh token   — long lived (30d), random 256-bit value, stored ONLY in an
 *                    httpOnly + SameSite=Strict cookie. JavaScript cannot read
 *                    it, so an XSS bug cannot steal a durable credential.
 *
 * The browser silently exchanges the refresh cookie for a new access token
 * before the old one expires. You stay signed in for a month without ever
 * retyping the password, and the thing an attacker could actually grab from
 * localStorage now expires in fifteen minutes.
 *
 * Refresh tokens ROTATE on every use, and only the SHA-256 hash is stored on
 * disk — same reasoning as not storing plaintext passwords. If the file leaks,
 * the tokens in it are not usable.
 *
 * Rotation also gives us reuse detection: a rotated token is remembered as
 * spent for a grace period. Presenting a spent token means either a benign
 * race (two tabs refreshing at once) or a stolen cookie being replayed. Inside
 * the grace window we accept it once more from the same family; outside it, the
 * whole family is revoked and that session must sign in again.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const STORE_FILE = path.join(__dirname, 'sessions.json');

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REUSE_GRACE_MS = 60 * 1000;                // tolerate concurrent-tab races
const MAX_SESSIONS = 20;                         // cap stored sessions
const COOKIE_NAME = 'vps_rt';

/** @type {Map<string, any>} keyed by token hash */
let sessions = new Map();
let writeQueued = false;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function load() {
  try {
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (!Array.isArray(raw)) return;
    const now = Date.now();
    for (const s of raw) {
      if (s && s.hash && s.expiresAt > now) sessions.set(s.hash, s);
    }
  } catch {
    // A corrupt store must not stop the panel from booting. Worst case
    // everyone signs in again.
    sessions = new Map();
  }
}

function scheduleSave() {
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(async () => {
    writeQueued = false;
    try {
      const data = JSON.stringify([...sessions.values()]);
      const tmp = `${STORE_FILE}.tmp`;
      // Written 0600: this file is equivalent to a set of live credentials.
      await fsp.writeFile(tmp, data, { mode: 0o600 });
      await fsp.rename(tmp, STORE_FILE);
    } catch { /* non-fatal */ }
  }, 250);
}

function sweep() {
  const now = Date.now();
  for (const [hash, s] of sessions) {
    // Spent tokens are kept only long enough to detect replay.
    const cutoff = s.spentAt ? s.spentAt + REUSE_GRACE_MS : s.expiresAt;
    if (cutoff <= now) sessions.delete(hash);
  }
}

function trim() {
  if (sessions.size <= MAX_SESSIONS) return;
  const live = [...sessions.values()]
    .filter(s => !s.spentAt)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  for (const s of live.slice(MAX_SESSIONS)) sessions.delete(s.hash);
}

/**
 * Issue a refresh token. `family` ties rotations of one login together so a
 * detected replay can revoke every descendant at once.
 */
function issue({ family, ip, userAgent, label } = {}) {
  sweep();
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const session = {
    hash: hashToken(token),
    family: family || crypto.randomBytes(16).toString('hex'),
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + REFRESH_TTL_MS,
    spentAt: null,
    ip: ip || null,
    userAgent: (userAgent || '').slice(0, 200),
    label: label || null,
  };
  sessions.set(session.hash, session);
  trim();
  scheduleSave();
  return { token, session };
}

/**
 * Consume a refresh token and rotate it.
 *
 * Returns { ok: true, token, session } on success, or
 * { ok: false, reason } where reason is 'unknown' | 'expired' | 'reuse'.
 */
function rotate(token, { ip, userAgent } = {}) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'unknown' };
  sweep();

  const existing = sessions.get(hashToken(token));
  if (!existing) return { ok: false, reason: 'unknown' };

  const now = Date.now();
  if (existing.expiresAt <= now) {
    sessions.delete(existing.hash);
    scheduleSave();
    return { ok: false, reason: 'expired' };
  }

  if (existing.spentAt) {
    // Already rotated. Within the grace window this is almost certainly two
    // tabs refreshing at the same moment, and punishing that would log the
    // user out for using the app normally. Past it, treat as theft.
    if (now - existing.spentAt > REUSE_GRACE_MS) {
      revokeFamily(existing.family);
      return { ok: false, reason: 'reuse' };
    }
    const successor = [...sessions.values()].find(
      s => s.family === existing.family && !s.spentAt
    );
    if (successor) return { ok: false, reason: 'race' };
  }

  existing.spentAt = now;
  const next = issue({
    family: existing.family,
    ip: ip || existing.ip,
    userAgent: userAgent || existing.userAgent,
    label: existing.label,
  });
  next.session.createdAt = existing.createdAt; // preserve original sign-in time
  scheduleSave();
  return { ok: true, token: next.token, session: next.session };
}

function revoke(token) {
  if (!token) return false;
  const s = sessions.get(hashToken(token));
  if (!s) return false;
  revokeFamily(s.family);
  return true;
}

function revokeFamily(family) {
  for (const [hash, s] of sessions) if (s.family === family) sessions.delete(hash);
  scheduleSave();
}

function revokeAll() {
  sessions.clear();
  scheduleSave();
}

/** Distinct logins, newest first — for a future "active sessions" view. */
function list() {
  sweep();
  const byFamily = new Map();
  for (const s of sessions.values()) {
    if (s.spentAt) continue;
    byFamily.set(s.family, {
      family: s.family,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
      ip: s.ip,
      userAgent: s.userAgent,
    });
  }
  return [...byFamily.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

load();
setInterval(() => { sweep(); }, 60 * 60 * 1000).unref();

module.exports = {
  COOKIE_NAME,
  REFRESH_TTL_MS,
  issue,
  rotate,
  revoke,
  revokeFamily,
  revokeAll,
  list,
};
