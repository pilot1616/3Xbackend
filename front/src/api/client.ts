import { clearSession, getSession } from '../lib/session';
import type { AgentChatRequest, AgentSourceSample, AgentStreamHandlers, AgentStreamStage } from '../types/api';

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
    const body = payload as Record<string, unknown> | null;
    const message =
      (body && typeof body.message === 'string' && body.message) ||
      (body && typeof body.detail === 'string' && body.detail) ||
      'request failed';
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

/**
 * 流式调用 /api/v1/agent/chat（SSE）。逐行解析 event/data 帧，
 * 按 event 类型分发给 handlers；网络层错误抛 ApiError。
 */
export async function streamAgentChat(payload: AgentChatRequest, handlers: AgentStreamHandlers): Promise<void> {
  const session = getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/agent/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    let message = 'request failed';
    try {
      const body = JSON.parse(text) as { message?: string };
      if (typeof body.message === 'string') {
        message = body.message;
      }
    } catch {
      // 非 JSON 错误体，用默认文案
    }
    throw new ApiError(response.status, message);
  }
  if (!response.body) {
    throw new ApiError(response.status || 502, 'empty stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (event: string, dataText: string) => {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(dataText);
    } catch {
      return;
    }
    const payload = parsed as Record<string, unknown>;
    if (event === 'meta' && handlers.onMeta) handlers.onMeta(payload as { run_id: string; conversation_id: string });
    else if (event === 'stage' && handlers.onStage) handlers.onStage(payload as { stage: AgentStreamStage });
    else if (event === 'sources' && handlers.onSources) handlers.onSources(payload as { query_summary: string; sources: AgentSourceSample[] });
    else if (event === 'delta' && handlers.onDelta) handlers.onDelta(payload as { text: string });
    else if (event === 'done' && handlers.onDone) handlers.onDone(payload as { message_id: string; reply: string });
    else if (event === 'error' && handlers.onError) handlers.onError(payload as { message: string });
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 帧以空行分隔；event: 和 data: 行成对出现
    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (dataLines.length > 0) {
        dispatch(event, dataLines.join('\n'));
      }
      separator = buffer.indexOf('\n\n');
    }
  }
}
