import fs from 'node:fs';
import path from 'node:path';

const FIELDS = ['provider', 'imageModel', 'apiKey', 'promptLang'];

export const SETTING_LIMITS = {
  concurrency: [1, 8],
  dailyCap: [1, 10000],
  maxBatch: [1, 500],
};

function normalize(raw) {
  const data = {};
  if (!raw || typeof raw !== 'object') return data;
  for (const key of FIELDS) {
    if (typeof raw[key] === 'string' && raw[key].trim()) data[key] = raw[key].trim();
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
    try {
      return normalize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return {};
    }
  }

  patch(values) {
    Object.assign(this.data, normalize(values));
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    return this.data;
  }
}
