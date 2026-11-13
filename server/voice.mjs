import fs from 'node:fs';
import path from 'node:path';
import { extFromMime, sniffExt } from './assets.mjs';

export class VoiceStore {
  constructor(dir) {
    this.dir = dir;
    this.metaFile = path.join(dir, 'voice.json');
    fs.mkdirSync(dir, { recursive: true });
  }

  #meta() {
    try {
      return JSON.parse(fs.readFileSync(this.metaFile, 'utf8'));
    } catch {
      return null;
    }
  }

  get() {
    const meta = this.#meta();
    if (!meta?.filename)
      return {
        exists: false,
        name: null,
        mime: null,
        durationSec: null,
        updatedAt: null,
        path: null,
      };
    const file = path.join(this.dir, meta.filename);
    return {
      exists: fs.existsSync(file),
      path: fs.existsSync(file) ? file : null,
      name: meta.name || meta.filename,
      mime: meta.mime || 'audio/wav',
      durationSec: Number(meta.durationSec) || null,
      updatedAt: meta.updatedAt || null,
    };
  }

  save({ data, mime, originalName }) {
    const clean = String(mime || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    let ext = clean.startsWith('audio/') ? extFromMime(clean, '') : '';
    if (!ext) ext = sniffExt(data);
    const filename = `reference.${ext}`;
    fs.mkdirSync(this.dir, { recursive: true });
    for (const name of fs.readdirSync(this.dir)) {
      if (name.startsWith('reference.')) fs.rmSync(path.join(this.dir, name), { force: true });
    }
    const target = path.join(this.dir, filename);
    fs.writeFileSync(target, data);
    return {
      filename,
      path: target,
      mime: clean || `audio/${ext}`,
      originalName: originalName || filename,
    };
  }

  setMeta({ filename, name, mime, durationSec }) {
    const data = {
      filename,
      name: name || filename,
      mime: mime || 'audio/wav',
      durationSec: Number(durationSec) || null,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.metaFile, JSON.stringify(data, null, 2), 'utf8');
    return data;
  }

  clear() {
    for (const name of fs.readdirSync(this.dir)) {
      if (name.startsWith('reference.') || name === path.basename(this.metaFile)) {
        fs.rmSync(path.join(this.dir, name), { force: true });
      }
    }
  }
}
