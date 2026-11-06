import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

function bool(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  return !/^(0|false|no|off)$/i.test(raw);
}

loadEnv(path.join(ROOT, '.env'));

const env = process.env;

export const config = {
  root: ROOT,
  host: '127.0.0.1',
  port: Number(env.PORT || 8787),
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  webDist: path.join(ROOT, 'web', 'dist'),
  provider: (env.IMAGE_PROVIDER || 'mock').toLowerCase(),
  promptLang: (env.PROMPT_LANG || 'en').toLowerCase() === 'zh' ? 'zh' : 'en',
  appendNegative: bool(env.APPEND_NEGATIVE, true),
  concurrency: Math.max(1, Math.min(8, Number(env.IMAGE_CONCURRENCY) || 2)),
  timeoutMs: Math.max(10000, Number(env.IMAGE_TIMEOUT_MS) || 180000),
  dailyCap: Math.max(1, Number(env.DAILY_IMAGE_CAP) || 200),
  requestSeed: bool(env.REQUEST_SEED, false),
  openai: {
    baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: env.OPENAI_API_KEY || '',
    model: env.IMAGE_MODEL || 'gpt-image-1',
    size: /^\d+x\d+$/.test(env.IMAGE_SIZE || '') ? env.IMAGE_SIZE : '1280x720',
    quality: env.IMAGE_QUALITY || '',
    responseFormat: (env.IMAGE_RESPONSE_FORMAT || 'auto').toLowerCase(),
    extraHeaders: parseJson(env.IMAGE_EXTRA_HEADERS, {}),
    extraBody: parseJson(env.IMAGE_EXTRA_BODY, {}),
  },
};
