const BASE = '';

function getToken(): string {
  return localStorage.getItem('vps_token') || '';
}

function headers(): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { ...headers(), ...opts?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export function apiGet<T = any>(path: string) { return api<T>(path); }

export function apiPost<T = any>(path: string, body?: any) {
  return api<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
}

export function apiDelete<T = any>(path: string, body?: any) {
  return api<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined });
}

/**
 * Download a file/dir via an authenticated request.
 *
 * The token is sent in the Authorization header and never placed in the URL,
 * so it cannot leak into access logs, proxy logs, or Referer headers.
 */
export async function downloadFile(path: string): Promise<void> {
  const res = await fetch(`${BASE}/api/files/download?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const fallback = path.split('/').filter(Boolean).pop() || 'download';
  const filename = match ? decodeURIComponent(match[1]) : fallback;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
