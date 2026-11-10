import { sniffExt } from '../assets.mjs';

export function mimeFor(data) {
  const ext = sniffExt(data);
  if (ext === 'jpg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  return 'image/png';
}

export function decodeBase64(value) {
  const raw = String(value).includes(',') ? String(value).split(',').pop() : String(value);
  return Buffer.from(raw, 'base64');
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const RETRYABLE = /HTTP (5\d\d|429)|fetch failed|network|timeout|aborted|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i;

export async function downloadImage(url, timeoutMs, signal) {
  const absolute = url.startsWith('data:') ? url : new URL(url).toString();
  if (absolute.startsWith('data:')) {
    const mime = /^data:([^;,]+)/.exec(absolute)?.[1] || 'image/png';
    return { data: decodeBase64(absolute), mime };
  }
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined =
        signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([timeout, signal]) : timeout;
      const res = await fetch(absolute, { signal: combined });
      if (!res.ok) {
        const error = new Error(`图片下载失败 HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }
      const data = Buffer.from(await res.arrayBuffer());
      return { data, mime: res.headers.get('content-type') || mimeFor(data) };
    } catch (error) {
      last = error;
      const retryable = RETRYABLE.test(String(error?.message || error)) || error?.status >= 500 || error?.status === 429;
      if (attempt === 2 || !retryable || signal?.aborted) throw error;
      await delay(500 * (attempt + 1));
    }
  }
  throw last;
}
