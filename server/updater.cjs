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
const https = require('https');

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

let timer = null;

/** Background polling. Runs shortly after boot, then on the configured
 *  interval. Failures are swallowed: an unreachable GitHub must never affect
 *  the panel's own availability. */
function startBackgroundChecks() {
  const config = loadConfig();
  if (!config.enabled) return;
  const run = () => { check({ force: true }).catch(() => {}); };
  setTimeout(run, 30_000).unref?.();
  if (timer) clearInterval(timer);
  timer = setInterval(run, Math.max(1, config.checkIntervalHours) * 3600 * 1000);
  timer.unref?.();
}

module.exports = {
  REPO,
  currentVersion,
  cmpVersion,
  loadConfig,
  saveConfig,
  check,
  readCache,
  shouldNotify,
  startBackgroundChecks,
  DEFAULT_CONFIG,
};
