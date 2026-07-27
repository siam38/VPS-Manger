/**
 * platform.ts — host layout, fetched from the server.
 *
 * The frontend used to hard-code `ALLOWED_BASES` and open the file browser at
 * a literal '/root'. That duplicated a server-side list *and* assumed a user
 * named `ubuntu`. On a Debian VPS the admin home is /home/debian, so both
 * copies were wrong and they could drift apart independently.
 *
 * One fetch at app start, cached. Everything else reads from here.
 */
import { apiGet } from './api';

export interface PlatformUser {
  name: string;
  uid: number;
  home: string;
}

export interface PlatformInfo {
  user: PlatformUser;
  isRoot: boolean;
  sudoUser: string | null;
  users: PlatformUser[];
  ssh: { home: string; keyPath: string; keyType: string; exists: boolean };
  init: {
    kind: 'systemd' | 'systemd-unavailable' | 'container' | 'openrc' | 'sysvinit' | 'unknown';
    pid1: string;
    inContainer: boolean;
    systemdUsable: boolean;
    hasCron: boolean;
  };
  pm2: {
    home: string;
    homeSource: string;
    expectedHome: string;
    homeMismatch: boolean;
    dumpFile: string;
  };
  allowedBases: string[];
  defaultPath: string;
  platform: { os: string; release: string; distro: string; arch: string };
}

/* Conservative fallback used only if the request fails. It must not claim to
 * know a username — guessing `ubuntu` is the bug this module exists to kill. */
const FALLBACK: PlatformInfo = {
  user: { name: 'root', uid: 0, home: '/root' },
  isRoot: true,
  sudoUser: null,
  users: [],
  ssh: { home: '/root', keyPath: '/root/.ssh/id_ed25519', keyType: 'ed25519', exists: false },
  init: { kind: 'unknown', pid1: '', inContainer: false, systemdUsable: false, hasCron: false },
  pm2: { home: '/root/.pm2', homeSource: 'default', expectedHome: '/root/.pm2', homeMismatch: false, dumpFile: '/root/.pm2/dump.pm2' },
  allowedBases: ['/root', '/home', '/var/www', '/opt', '/srv', '/tmp'],
  defaultPath: '/root',
  platform: { os: 'linux', release: '', distro: 'unknown', arch: '' },
};

let cached: PlatformInfo | null = null;
let inflight: Promise<PlatformInfo> | null = null;

export async function getPlatform(): Promise<PlatformInfo> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = apiGet<PlatformInfo>('/api/system/platform')
    .then(info => { cached = info; inflight = null; return info; })
    .catch(() => { inflight = null; return FALLBACK; });
  return inflight;
}

/** Synchronous read for code paths that cannot await. Null until loaded. */
export function platformSync(): PlatformInfo | null {
  return cached;
}

export function resetPlatform() {
  cached = null;
  inflight = null;
}

/** Which allowed base a path belongs to, for breadcrumb roots. */
export function baseOf(p: string, info: PlatformInfo): string {
  const match = info.allowedBases
    .filter(b => p === b || p.startsWith(b.endsWith('/') ? b : b + '/'))
    // Longest match wins: /home/debian beats /home.
    .sort((a, b) => b.length - a.length)[0];
  return match || info.defaultPath;
}
