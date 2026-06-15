#!/usr/bin/env node

/**
 * Git Auto-Sync Daemon
 * Watches configured repos for file changes and auto-pushes.
 * Periodically pulls and auto-resolves conflicts.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'git-sync-config.json');
const PID_FILE = '/tmp/git-sync-daemon.pid';
const LOG_FILE = '/tmp/git-sync-daemon.log';

let config = { repos: {} };
let watchers = new Map();
let intervals = new Map();
let pendingPush = new Map(); // debounce pushes

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
    // Keep log file under 100KB
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > 100000) {
      const content = fs.readFileSync(LOG_FILE, 'utf8');
      fs.writeFileSync(LOG_FILE, content.slice(-50000));
    }
  } catch {}
}

function git(cwd, cmd) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', timeout: 60000 }).trim();
}

function gitSafe(cwd, cmd) {
  try {
    return { ok: true, output: git(cwd, cmd) };
  } catch (e) {
    return { ok: false, error: e.stderr || e.message };
  }
}

function loadConfig() {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    config = { repos: {} };
  }
}

function hasChanges(repoPath) {
  const status = gitSafe(repoPath, 'status --porcelain');
  return status.ok && status.output.length > 0;
}

function autoCommitAndPush(repoPath, repoConfig) {
  if (!hasChanges(repoPath)) return;

  const timestamp = new Date().toISOString().replace(/[T]/g, ' ').replace(/\..+/, '');
  const msg = (repoConfig.commitMessage || 'auto-sync: {timestamp}').replace('{timestamp}', timestamp);

  log(`[${repoPath}] Changes detected, committing...`);

  // Stage all changes
  const addResult = gitSafe(repoPath, 'add -A');
  if (!addResult.ok) {
    log(`[${repoPath}] Stage failed: ${addResult.error}`);
    return;
  }

  // Check again after staging (gitignore might filter everything)
  const staged = gitSafe(repoPath, 'diff --cached --name-only');
  if (!staged.ok || !staged.output) {
    log(`[${repoPath}] Nothing to commit after staging`);
    return;
  }

  // Commit
  const commitResult = gitSafe(repoPath, `commit -m "${msg}"`);
  if (!commitResult.ok) {
    log(`[${repoPath}] Commit failed: ${commitResult.error}`);
    return;
  }
  log(`[${repoPath}] Committed: ${msg}`);

  // Push
  if (repoConfig.autoPush) {
    const branch = gitSafe(repoPath, 'branch --show-current');
    const branchName = branch.ok ? branch.output : 'main';
    const pushResult = gitSafe(repoPath, `push origin ${branchName}`);
    if (pushResult.ok) {
      log(`[${repoPath}] Pushed to origin/${branchName}`);
    } else {
      log(`[${repoPath}] Push failed: ${pushResult.error}`);
      // Try pull then push
      if (repoConfig.autoResolveConflicts) {
        resolveAndPush(repoPath, branchName, repoConfig);
      }
    }
  }
}

function autoPull(repoPath, repoConfig) {
  if (!repoConfig.autoPull) return;

  const branch = gitSafe(repoPath, 'branch --show-current');
  const branchName = branch.ok ? branch.output : 'main';

  // Fetch first
  const fetchResult = gitSafe(repoPath, 'fetch origin');
  if (!fetchResult.ok) {
    log(`[${repoPath}] Fetch failed: ${fetchResult.error}`);
    return;
  }

  // Check if behind
  const behind = gitSafe(repoPath, 'rev-list HEAD..@{u} --count');
  if (!behind.ok || behind.output === '0') return;

  log(`[${repoPath}] ${behind.output} commits behind, pulling...`);

  // Stash local changes if any
  const hasLocal = hasChanges(repoPath);
  if (hasLocal) {
    gitSafe(repoPath, 'stash push -m "auto-sync-stash"');
  }

  // Pull
  const pullResult = gitSafe(repoPath, `pull origin ${branchName} --no-edit`);
  if (pullResult.ok) {
    log(`[${repoPath}] Pulled from origin/${branchName}`);
    
    // Restart linked PM2 app if configured
    if (repoConfig.pm2App) {
      try {
        execSync(`pm2 restart "${repoConfig.pm2App}"`, { timeout: 15000 });
        log(`[${repoPath}] Restarted PM2 app: ${repoConfig.pm2App}`);
      } catch (e) {
        log(`[${repoPath}] Failed to restart PM2 app ${repoConfig.pm2App}: ${e.message}`);
      }
    }
  } else {
    log(`[${repoPath}] Pull failed: ${pullResult.error}`);
    if (repoConfig.autoResolveConflicts) {
      resolveConflicts(repoPath, repoConfig);
    }
  }

  // Pop stash
  if (hasLocal) {
    const popResult = gitSafe(repoPath, 'stash pop');
    if (!popResult.ok && repoConfig.autoResolveConflicts) {
      log(`[${repoPath}] Stash pop conflict, resolving...`);
      resolveConflicts(repoPath, repoConfig);
    }
  }
}

function resolveConflicts(repoPath, repoConfig) {
  log(`[${repoPath}] Resolving conflicts (keeping local changes)...`);

  // Get list of conflicted files
  const status = gitSafe(repoPath, 'status --porcelain');
  if (!status.ok) return;

  const conflicted = status.output.split('\n')
    .filter(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD'))
    .map(l => l.substring(3));

  if (conflicted.length === 0) {
    // Might be a merge in progress, try to abort and force
    gitSafe(repoPath, 'merge --abort');
    return;
  }

  // For each conflict, accept local version (theirs for pull = ours)
  conflicted.forEach(file => {
    // Accept ours (local) for conflicts
    gitSafe(repoPath, `checkout --ours "${file}"`);
    gitSafe(repoPath, `add "${file}"`);
    log(`[${repoPath}] Resolved conflict: ${file} (kept local)`);
  });

  // Complete the merge
  const commitResult = gitSafe(repoPath, 'commit --no-edit');
  if (commitResult.ok) {
    log(`[${repoPath}] Merge commit completed`);
  }
}

function resolveAndPush(repoPath, branchName, repoConfig) {
  log(`[${repoPath}] Attempting pull-resolve-push cycle...`);

  // Pull with rebase to keep it clean
  let pullResult = gitSafe(repoPath, `pull origin ${branchName} --no-edit`);
  if (!pullResult.ok) {
    // Conflict during pull
    resolveConflicts(repoPath, repoConfig);
  }

  // Try push again
  const pushResult = gitSafe(repoPath, `push origin ${branchName}`);
  if (pushResult.ok) {
    log(`[${repoPath}] Push succeeded after resolve`);
  } else {
    log(`[${repoPath}] Push still failing: ${pushResult.error}`);
    // Last resort: force push
    const forceResult = gitSafe(repoPath, `push origin ${branchName} --force`);
    if (forceResult.ok) {
      log(`[${repoPath}] Force pushed (last resort)`);
    } else {
      log(`[${repoPath}] FORCE PUSH FAILED: ${forceResult.error}`);
    }
  }
}

function setupWatcher(repoPath, repoConfig) {
  // Clean up existing
  if (watchers.has(repoPath)) {
    watchers.get(repoPath).close();
    watchers.delete(repoPath);
  }
  if (intervals.has(repoPath)) {
    clearInterval(intervals.get(repoPath));
    intervals.delete(repoPath);
  }

  if (!repoConfig.enabled) {
    log(`[${repoPath}] Auto-sync disabled`);
    return;
  }

  if (!fs.existsSync(repoPath)) {
    log(`[${repoPath}] Path does not exist, skipping`);
    return;
  }

  log(`[${repoPath}] Setting up auto-sync (interval: ${repoConfig.intervalSeconds}s)`);

  // File watcher for instant push on change
  let debounceTimer = null;
  try {
    const watcher = fs.watch(repoPath, { recursive: true }, (event, filename) => {
      // Skip .git directory and node_modules
      if (!filename || filename.startsWith('.git') || filename.includes('node_modules')) return;

      // Debounce: wait 5 seconds after last change before pushing
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          autoCommitAndPush(repoPath, repoConfig);
        } catch (e) {
          log(`[${repoPath}] Watch handler error: ${e.message}`);
        }
      }, 5000);
    });

    watchers.set(repoPath, watcher);
    watcher.on('error', (err) => {
      log(`[${repoPath}] Watcher error: ${err.message}`);
    });
  } catch (e) {
    log(`[${repoPath}] Failed to setup watcher: ${e.message}`);
  }

  // Periodic pull check
  const interval = setInterval(() => {
    try {
      autoPull(repoPath, repoConfig);
      // Also check for uncommitted changes (in case watcher missed something)
      autoCommitAndPush(repoPath, repoConfig);
    } catch (e) {
      log(`[${repoPath}] Interval handler error: ${e.message}`);
    }
  }, (repoConfig.intervalSeconds || 30) * 1000);

  intervals.set(repoPath, interval);

  // Do an initial sync
  try {
    autoPull(repoPath, repoConfig);
    autoCommitAndPush(repoPath, repoConfig);
  } catch (e) {
    log(`[${repoPath}] Initial sync error: ${e.message}`);
  }
}

function ensureInotifyLimit() {
  try {
    const current = parseInt(execSync('cat /proc/sys/fs/inotify/max_user_watches', { encoding: 'utf8' }).trim());
    if (current < 524288) {
      log(`inotify limit too low (${current}), bumping to 524288...`);
      execSync('echo 524288 > /proc/sys/fs/inotify/max_user_watches');
      // Persist across reboots
      try {
        const sysctl = fs.readFileSync('/etc/sysctl.conf', 'utf8');
        if (!sysctl.includes('fs.inotify.max_user_watches')) {
          fs.appendFileSync('/etc/sysctl.conf', '\nfs.inotify.max_user_watches=524288\n');
        }
      } catch {}
      log('inotify limit updated successfully');
    }
  } catch (e) {
    log(`Failed to check/set inotify limit: ${e.message}`);
  }
}

function reloadAll() {
  log('Reloading configuration...');
  loadConfig();

  // Stop watchers/intervals for repos that are removed OR disabled
  for (const [repoPath] of watchers) {
    if (!config.repos[repoPath] || !config.repos[repoPath].enabled) {
      watchers.get(repoPath).close();
      watchers.delete(repoPath);
      if (intervals.has(repoPath)) {
        clearInterval(intervals.get(repoPath));
        intervals.delete(repoPath);
      }
      if (!config.repos[repoPath]) {
        log(`[${repoPath}] Removed from sync`);
      }
    }
  }
  // Also clear intervals for disabled repos that might not have watchers
  for (const [repoPath] of intervals) {
    if (!config.repos[repoPath] || !config.repos[repoPath].enabled) {
      clearInterval(intervals.get(repoPath));
      intervals.delete(repoPath);
    }
  }

  // Setup/update all configured repos
  for (const [repoPath, repoConfig] of Object.entries(config.repos)) {
    setupWatcher(repoPath, repoConfig);
  }
}

// === MAIN ===
log('Git Auto-Sync Daemon starting...');

// Auto-fix inotify limit
ensureInotifyLimit();

// Write PID
fs.writeFileSync(PID_FILE, process.pid.toString());

// Handle reload signal
process.on('SIGUSR1', () => {
  log('Received SIGUSR1, reloading config...');
  reloadAll();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('Shutting down...');
  for (const [, watcher] of watchers) watcher.close();
  for (const [, interval] of intervals) clearInterval(interval);
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(0);
});

process.on('SIGINT', () => {
  log('Shutting down...');
  for (const [, watcher] of watchers) watcher.close();
  for (const [, interval] of intervals) clearInterval(interval);
  try { fs.unlinkSync(PID_FILE); } catch {}
  process.exit(0);
});

// Initial load
reloadAll();

// Keep alive even with no repos configured
setInterval(() => {
  // Periodic config check in case file was edited externally
  const newConf = (() => { try { return fs.readFileSync(CONFIG_PATH, 'utf8'); } catch { return '{}'; } })();
  // Just keep alive
}, 60000);

log('Git Auto-Sync Daemon running (PID: ' + process.pid + ')');
