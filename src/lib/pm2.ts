/**
 * pm2.ts — types, formatting and status semantics for the PM2 section.
 *
 * These lived inline in a 1,460-line PM2Manager.tsx alongside four components.
 * Pulled out so the pieces can be tested and reused, and so status colour is
 * decided in exactly one place.
 */

export interface PM2App {
  name: string;
  pm_id: number;
  monit: { cpu: number; memory: number };
  pm2_env: {
    status: string;
    restart_time: number;
    pm_uptime: number;
    exec_mode: string;
    instances: number;
    pm_exec_path: string;
    pm_cwd?: string;
    exec_interpreter?: string;
    autorestart?: boolean;
  };
}

export interface AppDetail {
  name: string;
  pm_id: number;
  monit: { cpu: number; memory: number };
  status: string;
  exec_mode: string;
  instances: number;
  pm_exec_path: string;
  pm_cwd: string;
  pm_out_log_path: string;
  pm_err_log_path: string;
  created_at: number;
  restart_time: number;
  pm_uptime: number;
  node_version: string;
  versioning: any;
  watch: boolean;
  autorestart: boolean;
  max_memory_restart: any;
  cron_restart: string;
  args: string[];
  node_args: string[];
  interpreter: string;
  env_vars: Record<string, string>;
}

export interface BrowseResult {
  path: string;
  parent: string;
  dirs: { name: string; path: string }[];
  projectFiles: { name: string; path: string; type: string }[];
}

export interface BootStatus {
  init: string;
  pid1: string;
  inContainer: boolean;
  pm2Home: string;
  pm2HomeSource: string;
  pm2HomeMismatch: boolean;
  expectedPm2Home: string;
  daemonAtBoot: boolean;
  method: 'systemd' | 'cron' | 'none';
  dumpExists: boolean;
  dumpSavedAt: string | null;
  savedApps: string[];
  warnings: string[];
  canConfigure: boolean;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'log';

export interface LogLine {
  id: number;
  seq: number;
  text: string;
  stream: 'out' | 'err';
  timestamp: string;
  level: LogLevel;
}

/* ── Status ────────────────────────────────────────────────────────────────
 * One source of truth. Colour is reserved for states that need attention:
 * errored is loud, stopped is quiet-neutral, online is calm. A healthy app
 * does not get a saturated colour just for existing.
 */
export type StatusTone = 'ok' | 'warn' | 'danger' | 'idle';

export function statusTone(status: string): StatusTone {
  switch (status) {
    case 'online': return 'ok';
    case 'launching':
    case 'stopping':
    case 'restarting': return 'warn';
    case 'errored': return 'danger';
    default: return 'idle';
  }
}

export const TONE_DOT: Record<StatusTone, string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  danger: 'bg-red-400',
  idle: 'bg-dark-500',
};

export const TONE_TEXT: Record<StatusTone, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  danger: 'text-red-400',
  idle: 'text-subtle',
};

/* ── Formatting ────────────────────────────────────────────────────────── */

export function formatUptime(ms: number, status?: string): string {
  // A stopped process has no uptime. The old row rendered `UP 16s` next to a
  // STOPPED badge because it formatted pm_uptime unconditionally — PM2 leaves
  // the last start timestamp in place after a process exits, so the counter
  // kept ticking for something that was not running.
  if (status && status !== 'online') return '—';
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 0) return '—';
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* CPU and memory thresholds. Below these an app is simply fine and gets no
 * colour at all — worklog 1's rule, which the old summary bar broke by
 * painting every tile a different hue regardless of value. */
export function cpuTone(cpu: number): StatusTone {
  if (cpu >= 90) return 'danger';
  if (cpu >= 70) return 'warn';
  return 'idle';
}

export function memTone(bytes: number, limit?: number): StatusTone {
  if (!limit) return 'idle';
  const pct = (bytes / limit) * 100;
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warn';
  return 'idle';
}

export function execMode(mode?: string): string {
  return (mode || 'fork').replace('_mode', '');
}

/* ── Logs ──────────────────────────────────────────────────────────────── */

export function parseLogLevel(text: string): LogLevel {
  if (/\b(error|err|fatal|exception|crash|uncaught)\b/i.test(text)) return 'error';
  if (/\b(warn|warning)\b/i.test(text)) return 'warn';
  if (/\b(debug|trace|verbose)\b/i.test(text)) return 'debug';
  if (/\b(info)\b/i.test(text)) return 'info';
  return 'log';
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}

export const LEVEL_TEXT: Record<LogLevel, string> = {
  error: 'text-red-400',
  warn: 'text-amber-400',
  info: 'text-sky-300',
  debug: 'text-subtle',
  log: 'text-dark-200',
};

/** Boot persistence, phrased as the three questions people actually mean. */
export function bootSummary(boot: BootStatus | null, appName: string): {
  onBoot: boolean;
  reason: string;
} {
  if (!boot) return { onBoot: false, reason: 'Checking…' };
  if (!boot.daemonAtBoot) {
    return { onBoot: false, reason: 'PM2 itself does not start at boot on this host' };
  }
  if (!boot.dumpExists) {
    return { onBoot: false, reason: 'No saved process list — nothing to restore' };
  }
  if (!boot.savedApps.includes(appName)) {
    return { onBoot: false, reason: 'Running but not in the saved list — save to include it' };
  }
  return { onBoot: true, reason: 'Saved and restored by PM2 at boot' };
}
