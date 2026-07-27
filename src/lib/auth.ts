/**
 * Access-token lifecycle for the browser.
 *
 * The panel used to store one 30-minute JWT and never touch it again. Half an
 * hour into editing a file, the save 401'd and you were back at the login
 * screen with unsaved work. That is the bug this module exists to kill.
 *
 * How it works now:
 *
 *   - The access token lives in memory, mirrored to localStorage only so a
 *     page reload has something to try immediately.
 *   - The real credential is an httpOnly cookie this file cannot read, by
 *     design. Every renewal is `POST /api/refresh` with `credentials:
 *     'include'`; the browser attaches the cookie itself.
 *   - A timer renews at ~80% of the token's lifetime, so a refresh normally
 *     happens while the current token is still perfectly valid. Nothing in the
 *     UI ever observes an expired token.
 *   - Renewal is also triggered when the tab regains focus or the network
 *     comes back, because background timers are throttled or frozen in
 *     backgrounded tabs and on sleeping phones. Without this, closing the lid
 *     for an hour would still log you out.
 *   - If a request 401s anyway, `api()` refreshes once and replays it. All
 *     concurrent 401s share that single refresh rather than stampeding.
 *
 * Only when the refresh cookie itself is gone or revoked does the session
 * genuinely end.
 */

const TOKEN_KEY = 'vps_token';

// Renew this far before expiry. At a 15-minute token that is ~12 minutes in,
// leaving a 3-minute cushion for a slow or briefly offline connection.
const RENEW_RATIO = 0.8;
const MIN_RENEW_MS = 30_000;

let accessToken: string | null = localStorage.getItem(TOKEN_KEY);
let renewTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<string | null> | null = null;
let expiresAt = 0;

type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();

/** Notified when the session ends for real, so the app can show the login page. */
export function onAuthChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(accessToken);
}

export function getToken(): string | null {
  return accessToken;
}

export function setToken(token: string, expiresInSeconds = 900) {
  accessToken = token;
  expiresAt = Date.now() + expiresInSeconds * 1000;
  localStorage.setItem(TOKEN_KEY, token);
  scheduleRenew(expiresInSeconds * 1000);
}

function clearToken() {
  accessToken = null;
  expiresAt = 0;
  localStorage.removeItem(TOKEN_KEY);
  if (renewTimer) { clearTimeout(renewTimer); renewTimer = null; }
}

function scheduleRenew(lifetimeMs: number) {
  if (renewTimer) clearTimeout(renewTimer);
  const delay = Math.max(MIN_RENEW_MS, lifetimeMs * RENEW_RATIO);
  renewTimer = setTimeout(() => { void refresh(); }, delay);
}

/**
 * Exchange the refresh cookie for a fresh access token.
 *
 * Concurrent callers share one request: a page with the dashboard polling,
 * a terminal open and a file save in flight can easily produce three
 * simultaneous 401s, and three parallel rotations would fight over the
 * rotating cookie.
 */
export function refresh(): Promise<string | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch('/api/refresh', {
        method: 'POST',
        credentials: 'include', // sends the httpOnly refresh cookie
        headers: { 'Content-Type': 'application/json' },
      });

      // 409 means a sibling tab rotated first and the cookie it set is already
      // the live one. Retrying once picks that up instead of ending a healthy
      // session over a race.
      if (res.status === 409) {
        await new Promise(r => setTimeout(r, 400));
        const retry = await fetch('/api/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!retry.ok) { endSession(); return null; }
        const data = await retry.json();
        setToken(data.token, data.expiresIn ?? 900);
        return data.token as string;
      }

      if (!res.ok) { endSession(); return null; }

      const data = await res.json();
      if (!data?.token) { endSession(); return null; }
      setToken(data.token, data.expiresIn ?? 900);
      return data.token as string;
    } catch {
      // A network blip is not an expired session. Keep the current token and
      // try again shortly; the focus/online hooks will also retry.
      scheduleRenew(60_000);
      return accessToken;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function endSession() {
  clearToken();
  emit();
}

/** Sign out everywhere: revokes server-side, then drops local state. */
export async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  } catch { /* best effort — local state is cleared regardless */ }
  clearToken();
  emit();
}

/**
 * Called once at boot. Tries the stored token, and falls back to the refresh
 * cookie — which is the path that matters after the token has expired while
 * the tab was closed.
 */
export async function bootstrap(): Promise<boolean> {
  if (accessToken) {
    try {
      const res = await fetch('/api/verify', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        // The stored token is valid but we do not know how much of its life is
        // left, so assume the worst and renew soon.
        scheduleRenew(MIN_RENEW_MS * 2);
        return true;
      }
    } catch { /* fall through to refresh */ }
  }
  const token = await refresh();
  return !!token;
}

/**
 * Renew opportunistically when the tab wakes up.
 *
 * Timers in a backgrounded tab are throttled, and on a sleeping phone they
 * stop entirely — the renewal that should have fired an hour ago never did.
 * Checking on wake is what makes "come back the next morning and it still
 * works" true.
 */
if (typeof window !== 'undefined') {
  const wake = () => {
    if (!accessToken) return;
    if (Date.now() > expiresAt - 120_000) void refresh();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);

  // Signing out in one tab must not leave the others live.
  window.addEventListener('storage', e => {
    if (e.key !== TOKEN_KEY) return;
    if (e.newValue === null) { clearToken(); emit(); }
    else { accessToken = e.newValue; }
  });
}
