import ky, { HTTPError, TimeoutError } from 'ky';

export type ApiError = Error & { payload?: unknown };

type ApiInit = RequestInit & { timeout?: number | false };

const DEFAULT_TIMEOUT = 60_000;
const UPLOAD_TIMEOUT = 300_000;

// 创建生成任务的 POST 涉及计费，绝不重试；只对幂等 GET 做一次网络/5xx/429 重试。
const request = ky.create({
  retry: {
    limit: 1,
    methods: ['get'],
    statusCodes: [408, 429, 500, 502, 503, 504],
  },
});

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function toApiError(error: unknown): Promise<unknown> {
  if (error instanceof HTTPError) {
    const payload = typeof error.data === 'string' ? null : (error.data ?? null);
    const message =
      (payload as { error?: string } | null)?.error || `HTTP ${error.response.status}`;
    const apiError = new Error(message) as ApiError;
    apiError.payload = payload;
    return apiError;
  }
  if (error instanceof TimeoutError) {
    return new Error('请求超时') as ApiError;
  }
  return error;
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  try {
    const text = await request(path, {
      ...init,
      timeout: init.timeout ?? DEFAULT_TIMEOUT,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    }).text();
    return parseJson(text) as T;
  } catch (error) {
    throw await toApiError(error);
  }
}

export function apiUpload<T>(
  path: string,
  file: Blob,
  headers: Record<string, string> = {},
): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    body: file,
    timeout: UPLOAD_TIMEOUT,
    headers: { 'Content-Type': file.type || 'application/octet-stream', ...headers },
  });
}
