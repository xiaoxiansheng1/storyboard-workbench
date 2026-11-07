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

export async function downloadImage(url, timeoutMs) {
  const absolute = url.startsWith('data:') ? url : new URL(url).toString();
  if (absolute.startsWith('data:')) {
    const mime = /^data:([^;,]+)/.exec(absolute)?.[1] || 'image/png';
    return { data: decodeBase64(absolute), mime };
  }
  const res = await fetch(absolute, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`图片下载失败 HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  return { data, mime: res.headers.get('content-type') || mimeFor(data) };
}
