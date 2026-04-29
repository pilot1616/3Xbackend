import { clearSession, getSession } from '../lib/session';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const ASSET_BASE_URL = (import.meta.env.VITE_ASSET_BASE_URL ?? API_BASE_URL).replace(/\/$/, '');

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function buildAssetUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${ASSET_BASE_URL}${normalized}`;
}

export function buildUploadAssetUrl(fileName: string) {
  return buildAssetUrl(`/public/uploads/${encodeURIComponent(fileName)}`);
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  const session = getSession();
  if (session?.token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${session.token}`);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const rawText = await response.text();
  const payload = isJson && rawText ? safeParseJson(rawText) : null;

  if (!response.ok) {
    if (response.status === 401) {
      clearSession();
    }
    const message = payload && typeof payload.message === 'string' ? payload.message : 'request failed';
    throw new ApiError(response.status, message);
  }

  return payload as T;
}

export function uploadRequest<T>(path: string, body: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}${path}`);

    const session = getSession();
    if (session?.token) {
      xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || !onProgress) {
        return;
      }
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      onProgress(percent);
    });

    xhr.addEventListener('load', () => {
      const contentType = xhr.getResponseHeader('content-type') ?? '';
      const isJson = contentType.includes('application/json');
      const payload = isJson && xhr.responseText ? safeParseJson(xhr.responseText) : null;

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as T);
        return;
      }

      if (xhr.status === 401) {
        clearSession();
      }

      const message = payload && typeof payload.message === 'string' ? payload.message : 'request failed';
      reject(new ApiError(xhr.status, message));
    });

    xhr.addEventListener('error', () => {
      reject(new ApiError(0, 'network error'));
    });

    xhr.send(body);
  });
}
