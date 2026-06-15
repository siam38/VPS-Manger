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

export function downloadUrl(path: string): string {
  return `${BASE}/api/files/download?path=${encodeURIComponent(path)}&token=${getToken()}`;
}
