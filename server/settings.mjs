import fs from 'node:fs';
import path from 'node:path';
import { readJsonSafe, writeJsonAtomic } from './utils/json-file.mjs';

export const AUDIO_INFER_MODES = ['普通推理', '批次推理'];

export const IMAGE_SIZES = ['1:1', '4:3', '3:4', '16:9', '9:16'];

export const DEFAULT_IMAGE_SIZE = '16:9';

const FIELDS = ['provider', 'imageModel', 'apiKey', 'promptLang', 'imageSize', 'audioBaseUrl', 'audioInferMode'];

export const SETTING_LIMITS = {
  concurrency: [1, 8],
  maxBatch: [1, 500],
};

function normalize(raw) {
  const data = {};
  if (!raw || typeof raw !== 'object') return data;
  for (const key of FIELDS) {
    if (typeof raw[key] === 'string' && raw[key].trim()) {
      const value = raw[key].trim();
      if (key === 'audioInferMode' && !AUDIO_INFER_MODES.includes(value)) continue;
      if (key === 'imageSize' && !IMAGE_SIZES.includes(value)) continue;
      data[key] = value;
    }
  }
  for (const [key, [min, max]] of Object.entries(SETTING_LIMITS)) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === '') continue;
    const value = Number(raw[key]);
    if (Number.isInteger(value)) data[key] = Math.max(min, Math.min(max, value));
  }
  return data;
}

export class Settings {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'settings.json');
    this.data = this.#load();
  }

  #load() {
    return readJsonSafe(this.file, {}, normalize);
  }

  patch(values) {
    Object.assign(this.data, normalize(values));
    fs.mkdirSync(this.dir, { recursive: true });
    writeJsonAtomic(this.file, this.data);
    return this.data;
  }
}
