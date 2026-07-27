import { getToken, refresh } from './auth';

const BASE = '';

function headers(): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` };
}

/**
 * Fetch with one automatic retry after a silent token refresh.
 *
 * The renewal timer means a 401 should be rare, but it is still reachable:
 * a laptop resuming from sleep, a tab throttled to death in the background, or
 * the server having restarted. Rather than surfacing that to the user as a
 * failed save, refresh once and replay the request. Concurrent 401s all wait
 * on the same refresh (see lib/auth).
 */
async function authedFetch(url: string, opts?: RequestInit): Promise<Response> {
  const send = () =>
    fetch(url, { ...opts, headers: { ...headers(), ...opts?.headers } });

  let res = await send();
  if (res.status === 401) {
    const token = await refresh();
    if (token) res = await send();
  }
  return res;
}

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await authedFetch(`${BASE}${path}`, opts);
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
 * Fetch a file as an object URL for inline preview.
 *
 * Same reasoning as downloadFile: the token goes in the header, never the URL,
 * so it cannot end up in access logs or a Referer. Callers must revoke the
 * returned URL when the preview closes.
 */
export async function fetchBlobUrl(
  path: string
): Promise<{ url: string; type: string; size: number }> {
  const res = await authedFetch(`${BASE}/api/files/download?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type, size: blob.size };
}

/**
 * Upload with real progress. `fetch` cannot report upload progress, so this
 * uses XHR — the old implementation gave no feedback at all on a 100MB file.
 */
export function uploadFiles(
  destPath: string,
  files: File[],
  onProgress?: (percent: number, loaded: number, total: number) => void
): { promise: Promise<any>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const fd = new FormData();
  fd.append('path', destPath);
  files.forEach(f => fd.append('files', f));

  const promise = new Promise<any>((resolve, reject) => {
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
      }
    });
    xhr.addEventListener('load', () => {
      let body: any = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Upload failed (${xhr.status})`));
    });
    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
    xhr.open('POST', `${BASE}/api/files/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken() ?? ''}`);
    xhr.send(fd);
  });

  return { promise, abort: () => xhr.abort() };
}

/**
 * Download a file/dir via an authenticated request.
 *
 * The token is sent in the Authorization header and never placed in the URL,
 * so it cannot leak into access logs, proxy logs, or Referer headers.
 */
export async function downloadFile(path: string): Promise<void> {
  const res = await authedFetch(`${BASE}/api/files/download?path=${encodeURIComponent(path)}`);
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
