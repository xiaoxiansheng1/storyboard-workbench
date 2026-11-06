import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

export function extFromMime(mime, fallback = 'png') {
  const clean = String(mime || '').split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[clean] || fallback;
}

export function sniffExt(buffer) {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
  if (buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF') return 'webp';
  if (buffer.length > 4 && buffer.toString('ascii', 0, 4) === '<svg') return 'svg';
  return 'png';
}

export function saveAsset(assetsDir, nodeId, { data, mime }) {
  const dir = path.join(assetsDir, nodeId);
  fs.mkdirSync(dir, { recursive: true });
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  let ext = extFromMime(mime, '');
  if (!ext) ext = sniffExt(data);
  const filename = `${id}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), data);
  return {
    id,
    filename,
    url: `/assets/${nodeId}/${filename}`,
  };
}
