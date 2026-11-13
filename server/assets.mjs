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
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/ogg': 'ogv',
  'video/x-msvideo': 'avi',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'weba',
};

export function extFromMime(mime, fallback = 'png') {
  const clean = String(mime || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return EXT_BY_MIME[clean] || fallback;
}

export function sniffExt(buffer) {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
  if (buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF') {
    const type = buffer.toString('ascii', 8, 12);
    if (type === 'WEBP') return 'webp';
    if (type === 'AVI ') return 'avi';
    if (type === 'WAVE') return 'wav';
  }
  if (buffer.length > 4 && buffer.toString('ascii', 0, 4) === 'fLaC') return 'flac';
  if (buffer.length > 4 && buffer.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (buffer.length > 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'aac';
  if (buffer.length > 3 && buffer.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buffer.length > 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3';
  if (buffer.length > 4 && buffer.toString('ascii', 0, 4) === '<svg') return 'svg';
  if (buffer.length > 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  if (
    buffer.length > 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'webm';
  }
  return 'png';
}

export function saveAsset(assetsDir, nodeId, { data, mime }, urlBase = '/assets') {
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
    url: `${urlBase}/${nodeId}/${filename}`,
  };
}

// 只保留仍被节点引用的文件，清空候选或重新生成时回收旧图
export function pruneAssets(assetsDir, nodeId, keep = []) {
  const dir = path.join(assetsDir, nodeId);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  const keepSet = new Set(keep.filter(Boolean));
  let removed = 0;
  for (const name of names) {
    if (keepSet.has(name)) continue;
    try {
      fs.rmSync(path.join(dir, name), { force: true });
      removed += 1;
    } catch {
      // 文件已不存在时忽略
    }
  }
  return removed;
}
