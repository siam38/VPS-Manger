/**
 * updater.cjs — self-update subsystem (detection half).
 *
 * Deliberately independent of GitSync and of git entirely: it speaks only to
 * the GitHub Releases API over anonymous HTTPS. That is what makes it work on
 * any Linux VPS, including boxes with no SSH key, no remote and no git at all.
 *
 * This file is READ-ONLY with respect to the installation. It never modifies
 * the app. Applying an update lives in scripts/updater.mjs (phase 3).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

const REPO = 'siam38/VPS-Manger';
const API = `https://api.github.com/repos/${REPO}`;
const ROOT = path.join(__dirname, '..');
const CACHE_FILE = path.join(__dirname, 'update-cache.json');
const CONFIG_FILE = path.join(__dirname, 'update-config.json');
const UA = 'vps-manager-updater';

const DEFAULT_CONFIG = {
  enabled: true,
  channel: 'stable',        // stable = published releases only; beta = include prereleases
  checkIntervalHours: 6,
  autoInstall: false,       // off by default: this is a root panel
  autoInstallWindow: null,  // e.g. { start: '03:00', end: '05:00' }
  snoozedUntil: null,       // epoch ms
  skippedVersion: null,     // e.g. '3.2.0'
};

// ─── small helpers ───

function readJson(file, fallback) {
  try { return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { return { ...fallback }; }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file); // atomic: a crash mid-write can't leave a half file
}

function loadConfig() { return readJson(CONFIG_FILE, DEFAULT_CONFIG); }

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  writeJson(CONFIG_FILE, next);
  return next;
}

function currentVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; }
  catch { return '0.0.0'; }
}

/** Semver compare, tolerant of a leading `v` and of prerelease suffixes. */
function cmpVersion(a, b) {
  const norm = v => String(v || '').replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const x = norm(a), y = norm(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  }
  return 0;
}

/**
 * GET JSON from the GitHub API.
 * Anonymous, so it is subject to the 60 req/hour/IP unauthenticated limit —
 * which is exactly why results are cached and checks are hourly at most.
 */
function apiGet(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
      timeout: timeoutMs,
    }, res => {
      // Releases live behind a redirect on some endpoints.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(apiGet(res.headers.location, timeoutMs));
      }
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        if (res.statusCode === 404) return resolve({ notFound: true, rate: rateOf(res) });
        if (res.statusCode === 403 && /rate limit/i.test(body)) {
          return reject(Object.assign(new Error('GitHub API rate limit reached'), { code: 'RATE_LIMIT' }));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`GitHub API ${res.statusCode}`));
        }
        try { resolve({ data: JSON.parse(body), rate: rateOf(res) }); }
        catch { reject(new Error('Malformed API response')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('GitHub API timed out')); });
    req.on('error', err => {
      // No DNS / no route / TLS failure => the box simply cannot reach GitHub.
      if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'ETIMEDOUT'].includes(err.code)) {
        return reject(Object.assign(new Error('Cannot reach GitHub from this host'), { code: 'OFFLINE' }));
      }
      reject(err);
    });
  });
}

function rateOf(res) {
  return {
    remaining: Number(res.headers['x-ratelimit-remaining'] ?? -1),
    resetAt: Number(res.headers['x-ratelimit-reset'] ?? 0) * 1000 || null,
  };
}

// ─── changelog shaping ───

const TYPE_LABELS = {
  feat: 'Features', fix: 'Fixes', perf: 'Performance', refactor: 'Refactors',
  docs: 'Docs', style: 'Style', test: 'Tests', build: 'Build', ci: 'CI', chore: 'Chores',
};

/** Split a conventional-commit subject into { type, scope, subject }. */
function parseCommitSubject(raw) {
  const m = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/.exec(raw || '');
  if (!m) return { type: 'other', scope: null, subject: raw || '' };
  const type = TYPE_LABELS[m[1].toLowerCase()] ? m[1].toLowerCase() : 'other';
  return { type, scope: m[2] || null, subject: m[3] };
}

function groupCommits(commits) {
  const order = ['feat', 'fix', 'perf', 'refactor', 'docs', 'style', 'test', 'build', 'ci', 'chore', 'other'];
  const buckets = new Map();
  for (const c of commits) {
    if (!buckets.has(c.type)) buckets.set(c.type, []);
    buckets.get(c.type).push(c);
  }
  return order
    .filter(t => buckets.has(t))
    .map(t => ({ type: t, label: TYPE_LABELS[t] || 'Other', commits: buckets.get(t) }));
}

// ─── the check ───

/**
 * Compare the installed version against the newest release, and build the
 * commit-level changelog between the two tags.
 *
 * Never throws for the "nothing published yet" or "offline" cases — those are
 * normal states for a fresh repo or an air-gapped VPS, not errors.
 */
async function performCheck() {
  const config = loadConfig();
  const version = currentVersion();
  const base = {
    checkedAt: Date.now(),
    currentVersion: version,
    latestVersion: null,
    latestTag: null,
    updateAvailable: false,
    releaseUrl: null,
    releaseName: null,
    releaseNotes: null,
    publishedAt: null,
    prerelease: false,
    tarballUrl: null,
    commits: [],
    groups: [],
    commitCount: 0,
    truncated: false,
    reachable: true,
    reason: null,
    rate: null,
  };

  let releases;
  try {
    const wantPrerelease = config.channel === 'beta';
    const r = await apiGet(`${API}/releases?per_page=20`);
    if (r.notFound) return { ...base, reason: 'no-releases' };
    base.rate = r.rate;
    releases = (r.data || []).filter(x => !x.draft && (wantPrerelease || !x.prerelease));
  } catch (err) {
    return {
      ...base,
      reachable: err.code !== 'OFFLINE',
      reason: err.code === 'OFFLINE' ? 'offline' : err.code === 'RATE_LIMIT' ? 'rate-limit' : 'error',
      error: err.message,
    };
  }

  // No published releases: fall back to plain tags. This is what lets the whole
  // system run on `git tag v3.2.0 && git push --tags` with no GitHub UI and no
  // token anywhere. Releases are simply the richer option when notes exist.
  if (!releases.length) {
    try {
      const t = await apiGet(`${API}/tags?per_page=50`);
      const tags = (t.data || []).filter(x => /^v?\d+\.\d+\.\d+/.test(x.name));
      if (!tags.length) return { ...base, reason: 'no-releases' };
      releases = tags.map(x => ({
        tag_name: x.name,
        name: x.name,
        body: null,
        html_url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(x.name)}`,
        published_at: null,
        prerelease: false,
        tarball_url: x.tarball_url,
        _fromTag: true,
      }));
      base.source = 'tags';
    } catch (err) {
      return {
        ...base,
        reachable: err.code !== 'OFFLINE',
        reason: err.code === 'OFFLINE' ? 'offline' : err.code === 'RATE_LIMIT' ? 'rate-limit' : 'error',
        error: err.message,
      };
    }
  } else {
    base.source = 'releases';
  }

  // Highest semver wins — GitHub's ordering is by date, which is not the same
  // thing once you publish a patch for an older line.
  const latest = releases.reduce((a, b) => (cmpVersion(b.tag_name, a.tag_name) > 0 ? b : a));
  base.latestVersion = String(latest.tag_name).replace(/^v/, '');
  base.latestTag = latest.tag_name;
  base.releaseUrl = latest.html_url;
  base.releaseName = latest.name || latest.tag_name;
  base.releaseNotes = latest.body || null;
  base.publishedAt = latest.published_at;
  base.prerelease = !!latest.prerelease;
  base.tarballUrl = latest.tarball_url;
  base.updateAvailable = cmpVersion(base.latestVersion, version) > 0;

  if (!base.updateAvailable) return { ...base, reason: 'up-to-date' };

  // Changelog: every commit between the installed tag and the new one.
  try {
    const from = releases.find(r => cmpVersion(r.tag_name, version) === 0);
    const fromRef = from ? from.tag_name : null;
    if (fromRef) {
      const cmp = await apiGet(`${API}/compare/${encodeURIComponent(fromRef)}...${encodeURIComponent(latest.tag_name)}`);
      if (cmp.data) {
        base.commitCount = cmp.data.total_commits ?? (cmp.data.commits || []).length;
        base.truncated = base.commitCount > (cmp.data.commits || []).length;
        base.commits = (cmp.data.commits || []).map(c => {
          const subjectLine = (c.commit.message || '').split('\n')[0];
          const parsed = parseCommitSubject(subjectLine);
          return {
            hash: c.sha.slice(0, 7),
            fullHash: c.sha,
            ...parsed,
            author: c.commit.author?.name || c.author?.login || 'unknown',
            date: c.commit.author?.date || null,
            url: c.html_url,
          };
        }).reverse(); // newest first
        base.groups = groupCommits(base.commits);
      }
    } else {
      // The installed version has no matching tag (dev build, or a release was
      // deleted). Release notes still tell the story; commits can't be derived.
      base.reason = 'no-base-tag';
    }
  } catch (err) {
    base.reason = 'changelog-unavailable';
    base.error = err.message;
  }

  return base;
}

// ─── cache + public surface ───

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return null; }
}

let inFlight = null;

/**
 * Cached check. Concurrent callers share one request — five open browser tabs
 * must not become five API calls against a 60/hour anonymous budget.
 */
async function check({ force = false } = {}) {
  const config = loadConfig();
  const cached = readCache();
  const maxAge = Math.max(1, config.checkIntervalHours) * 3600 * 1000;

  if (!force && cached && Date.now() - cached.checkedAt < maxAge) {
    return { ...cached, cached: true };
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const result = await performCheck();
      try { writeJson(CACHE_FILE, result); } catch {}
      return { ...result, cached: false };
    } catch (err) {
      if (cached) return { ...cached, cached: true, staleError: err.message };
      throw err;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Should the UI show the popup right now? Snooze/skip live server-side so a
 *  dismissal on your phone is honoured on the desktop too. */
function shouldNotify(result, config = loadConfig()) {
  if (!config.enabled) return { notify: false, reason: 'disabled' };
  if (!result?.updateAvailable) return { notify: false, reason: result?.reason || 'up-to-date' };
  if (config.skippedVersion && cmpVersion(config.skippedVersion, result.latestVersion) >= 0) {
    return { notify: false, reason: 'skipped' };
  }
  if (config.snoozedUntil && Date.now() < config.snoozedUntil) {
    return { notify: false, reason: 'snoozed', until: config.snoozedUntil };
  }
  return { notify: true };
}

// ─── unattended installs ───

/** Minutes since midnight for an 'HH:MM' string, or null if unparseable. */
function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is `now` inside the configured install window?
 *
 * No window means "any time". A window that wraps past midnight (22:00–04:00)
 * is the normal case for a maintenance slot, so the wrapped comparison is the
 * point rather than an edge case.
 */
function inInstallWindow(window, now = new Date()) {
  if (!window || !window.start || !window.end) return true;
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  if (start === null || end === null) return true; // malformed: don't block forever
  const cur = now.getHours() * 60 + now.getMinutes();
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

/**
 * Decide whether to install this result without asking.
 *
 * Deliberately honours skip and snooze exactly like the popup does: dismissing
 * a version on your phone must not be overridden by a background timer
 * installing it twenty minutes later. Auto-install changes WHO clicks the
 * button, not WHICH versions are eligible.
 *
 * Prereleases are never auto-installed, even on the beta channel — opting into
 * seeing them is not the same as opting into unattended installs of them.
 */
function autoInstallDecision(result, config = loadConfig(), now = new Date()) {
  if (!config.enabled) return { install: false, reason: 'disabled' };
  if (!config.autoInstall) return { install: false, reason: 'auto-install-off' };
  if (!result?.updateAvailable) return { install: false, reason: result?.reason || 'up-to-date' };
  if (!result.tarballUrl || !result.latestTag) return { install: false, reason: 'no-tarball' };
  if (result.prerelease) return { install: false, reason: 'prerelease' };
  if (config.skippedVersion && cmpVersion(config.skippedVersion, result.latestVersion) >= 0) {
    return { install: false, reason: 'skipped' };
  }
  if (config.snoozedUntil && Date.now() < config.snoozedUntil) {
    return { install: false, reason: 'snoozed', until: config.snoozedUntil };
  }
  if (!inInstallWindow(config.autoInstallWindow, now)) {
    return { install: false, reason: 'outside-window', window: config.autoInstallWindow };
  }

  // Never start a second run on top of a live one, and never immediately
  // retry a version that just failed: a broken release would otherwise be
  // reinstalled every check interval, rolling the panel back and forth on its
  // own. A failure is retried only after the retry backoff has elapsed.
  const status = readStatus();
  if (status?.running) return { install: false, reason: 'already-running' };
  if (status && status.ok === false && status.toVersion === result.latestVersion) {
    const since = Date.now() - (status.finishedAt || 0);
    if (since < AUTO_RETRY_BACKOFF_MS) {
      return { install: false, reason: 'recent-failure', retryAfter: (status.finishedAt || 0) + AUTO_RETRY_BACKOFF_MS };
    }
  }

  return { install: true, tag: result.latestTag, tarballUrl: result.tarballUrl, version: result.latestVersion };
}

// A failed auto-install waits this long before the same version is retried.
const AUTO_RETRY_BACKOFF_MS = 6 * 3600 * 1000;

let timer = null;
let windowTimer = null;
let onAutoInstall = null;

/** Called by the server so an unattended install can be written to the audit log. */
function setAutoInstallHook(fn) { onAutoInstall = typeof fn === 'function' ? fn : null; }

/**
 * Evaluate the cached result for an unattended install, and start one if it
 * qualifies. Safe to call often — every gate above is idempotent.
 */
function maybeAutoInstall(result) {
  let decision;
  try { decision = autoInstallDecision(result); }
  catch { return { install: false, reason: 'error' }; }
  if (!decision.install) return decision;
  try {
    const started = startUpdate({ tag: decision.tag, tarballUrl: decision.tarballUrl, auto: true });
    try { onAutoInstall?.(decision); } catch {}
    return { ...decision, started };
  } catch (err) {
    return { install: false, reason: 'start-failed', error: err.message };
  }
}

/** Background polling. Runs shortly after boot, then on the configured
 *  interval. Failures are swallowed: an unreachable GitHub must never affect
 *  the panel's own availability. */
function startBackgroundChecks() {
  const config = loadConfig();
  if (!config.enabled) return;
  const run = () => {
    check({ force: true }).then(result => { maybeAutoInstall(result); }).catch(() => {});
  };
  setTimeout(run, 30_000).unref?.();
  if (timer) clearInterval(timer);
  timer = setInterval(run, Math.max(1, config.checkIntervalHours) * 3600 * 1000);
  timer.unref?.();

  // A separate, cheap tick for the install window. Without it, a 6-hour check
  // interval and a 2-hour maintenance window can miss each other indefinitely:
  // the check that found the update ran outside the window, and the next one
  // lands outside it too. This re-evaluates the CACHED result only — it makes
  // no API calls, so it costs nothing against the 60/hour anonymous budget.
  if (windowTimer) clearInterval(windowTimer);
  windowTimer = setInterval(() => {
    try {
      const cfg = loadConfig();
      if (!cfg.enabled || !cfg.autoInstall) return;
      const cached = readCache();
      if (cached) maybeAutoInstall(cached);
    } catch {}
  }, 10 * 60 * 1000);
  windowTimer.unref?.();
}

// ─── applying ───

const STATUS_FILE = path.join(__dirname, 'update-status.json');
const RUNNER = path.join(ROOT, 'scripts', 'update-runner.mjs');

function readStatus() {
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    // A runner killed mid-flight would otherwise leave `running: true` forever.
    if (s.running && Date.now() - (s.startedAt || 0) > 45 * 60 * 1000) {
      return { ...s, running: false, ok: false, error: 'Update timed out' };
    }
    // A finished run is history, not current state. Reporting a failure from
    // hours ago as though it were live is how the panel ends up insisting it
    // is broken while serving perfectly well.
    if (!s.running && s.finishedAt && Date.now() - s.finishedAt > 24 * 3600 * 1000) {
      return null;
    }
    return s;
  } catch { return null; }
}

/** Clear the finished-run record. Refuses while an update is in flight. */
function clearStatus() {
  const s = readStatus();
  if (s?.running) return { cleared: false, reason: 'An update is still running' };
  try { fs.unlinkSync(STATUS_FILE); } catch {}
  return { cleared: true };
}

/**
 * Launch the runner detached, from a COPY outside the install directory.
 *
 * Running it in place would mean executing a file that the update is about to
 * overwrite. Copying to a temp dir first removes that entire class of failure.
 */
function startUpdate({ tag, tarballUrl, auto = false }) {
  if (!fs.existsSync(RUNNER)) throw new Error('Update runner is missing from this installation');

  const tmpRunner = path.join(
    os.tmpdir(),
    `vps-manager-update-runner-${Date.now()}.mjs`
  );
  fs.copyFileSync(RUNNER, tmpRunner);

  const logFd = fs.openSync(path.join(os.tmpdir(), 'vps-manager-update.log'), 'a');
  const child = spawn(process.execPath, [tmpRunner, ROOT, tag, tarballUrl], {
    cwd: os.tmpdir(),
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env },
  });
  child.unref();

  const initial = {
    running: true,
    ok: null,
    step: 'check',
    message: 'Starting…',
    fromVersion: currentVersion(),
    toVersion: String(tag).replace(/^v/, ''),
    startedAt: Date.now(),
    pid: child.pid,
    auto,
    log: [],
  };
  try { writeJson(STATUS_FILE, initial); } catch {}
  return { pid: child.pid, tag };
}

module.exports = {
  REPO,
  currentVersion,
  cmpVersion,
  loadConfig,
  saveConfig,
  check,
  readCache,
  readStatus,
  clearStatus,
  startUpdate,
  shouldNotify,
  startBackgroundChecks,
  autoInstallDecision,
  inInstallWindow,
  maybeAutoInstall,
  setAutoInstallHook,
  DEFAULT_CONFIG,
};
