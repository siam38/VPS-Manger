import { apiGet, apiPost } from './api';

export interface UpdateCommit {
  hash: string;
  fullHash: string;
  type: string;
  scope: string | null;
  subject: string;
  author: string;
  date: string | null;
  url: string;
}

export interface UpdateGroup {
  type: string;
  label: string;
  commits: UpdateCommit[];
}

export interface UpdateConfig {
  enabled: boolean;
  channel: 'stable' | 'beta';
  checkIntervalHours: number;
  autoInstall: boolean;
  autoInstallWindow: { start: string; end: string } | null;
  snoozedUntil: number | null;
  skippedVersion: string | null;
}

export interface UpdateCheck {
  checkedAt: number;
  currentVersion: string;
  latestVersion: string | null;
  latestTag: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  prerelease: boolean;
  commits: UpdateCommit[];
  groups: UpdateGroup[];
  commitCount: number;
  truncated: boolean;
  reachable: boolean;
  source?: 'releases' | 'tags';
  reason: string | null;
  error?: string;
  cached?: boolean;
  notify?: { notify: boolean; reason?: string; until?: number };
  config?: UpdateConfig;
}

export interface UpdateStatus {
  running: boolean;
  ok: boolean | null;
  step: string | null;
  steps?: string[];
  message?: string;
  fromVersion?: string | null;
  toVersion?: string | null;
  startedAt?: number;
  finishedAt?: number | null;
  rolledBack?: boolean;
  error?: string | null;
  log?: string[];
}

export const STEP_LABELS: Record<string, string> = {
  check: 'Checking',
  backup: 'Backing up',
  download: 'Downloading',
  install: 'Installing dependencies',
  build: 'Building',
  verify: 'Verifying',
  swap: 'Installing',
  restart: 'Restarting',
  done: 'Done',
};

export const applyUpdate = () => apiPost<{ started: boolean; pid: number }>('/api/update/apply');

/**
 * Status is fetched WITHOUT auth helpers on purpose. During the restart the
 * server is briefly gone and the token may be unusable; this endpoint is
 * public so the browser can still tell whether the panel came back.
 */
export async function fetchUpdateStatus(): Promise<UpdateStatus | null> {
  try {
    const res = await fetch('/api/update/status', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // server is mid-restart: unreachable is expected, not an error
  }
}

export type SnoozeDuration = '1h' | '1d' | '1w';

export const checkForUpdate = (force = false) =>
  apiGet<UpdateCheck>(`/api/update/check${force ? '?force=1' : ''}`);

export const getUpdateConfig = () => apiGet<UpdateConfig>('/api/update/config');

export const saveUpdateConfig = (patch: Partial<UpdateConfig>) =>
  apiPost<UpdateConfig>('/api/update/config', patch);

export const snoozeUpdate = (duration: SnoozeDuration) =>
  apiPost<UpdateConfig>('/api/update/snooze', { duration });

export const skipUpdateVersion = (version: string) =>
  apiPost<UpdateConfig>('/api/update/skip', { version });

export const resetDismissals = () => apiPost<UpdateConfig>('/api/update/reset-dismissals');

/** Dismiss the record of a finished run. A past failure is history, not the
 *  panel's current state. */
export const clearUpdateStatus = () => apiPost<{ cleared: boolean }>('/api/update/status/clear');

/**
 * Human copy for the non-actionable outcomes. These are states, not errors —
 * a VPS with no route to GitHub is a supported deployment, not a fault.
 */
export function reasonLabel(r: UpdateCheck): string {
  switch (r.reason) {
    case 'up-to-date':   return 'You are on the latest version.';
    case 'no-releases':  return 'No releases published yet.';
    case 'offline':      return 'This server cannot reach GitHub.';
    case 'rate-limit':   return 'GitHub rate limit reached. Try again later.';
    case 'no-base-tag':  return 'Installed version has no matching tag, so the commit list is unavailable.';
    case 'changelog-unavailable': return 'Update found, but the commit list could not be loaded.';
    case 'error':        return r.error || 'Update check failed.';
    default:             return r.updateAvailable ? 'Update available.' : 'Up to date.';
  }
}

export function formatChecked(ts?: number): string {
  if (!ts) return 'never';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
