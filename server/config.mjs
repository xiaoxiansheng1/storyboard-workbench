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
const dataDir = path.resolve(ROOT, env.DATA_DIR || 'data');

function siblingTool(bin, name) {
  if (!/ffmpeg/i.test(path.basename(bin))) return name;
  return path.join(path.dirname(bin), path.basename(bin).replace(/ffmpeg/i, name));
}

const ffmpegPath = env.FFMPEG_PATH || 'ffmpeg';

export const config = {
  root: ROOT,
  host: '127.0.0.1',
  port: Number(env.PORT || 8787),
  dataDir,
  exportDir: path.join(dataDir, 'exports'),
  ffmpegPath,
  ffprobePath: env.FFPROBE_PATH || siblingTool(ffmpegPath, 'ffprobe'),
  webDist: path.join(ROOT, 'web', 'dist'),
  provider: (env.IMAGE_PROVIDER || 'aiclone').toLowerCase(),
  promptLang: (env.PROMPT_LANG || 'zh').toLowerCase() === 'en' ? 'en' : 'zh',
  appendNegative: bool(env.APPEND_NEGATIVE, true),
  concurrency: Math.max(1, Math.min(8, Number(env.IMAGE_CONCURRENCY) || 2)),
  timeoutMs: Math.max(10000, Number(env.IMAGE_TIMEOUT_MS) || 180000),
  dailyCap: Math.max(1, Number(env.DAILY_IMAGE_CAP) || 200),
  maxBatch: Math.max(1, Math.min(500, Number(env.MAX_BATCH_SIZE) || 50)),
  requestSeed: bool(env.REQUEST_SEED, false),
  aiclone: {
    baseUrl: (env.AICLONE_BASE_URL || 'https://api.aiclonevoicefree.com').replace(/\/+$/, ''),
    apiKey: env.AICLONE_API_KEY || '',
    model: env.AICLONE_IMAGE_MODEL || 'gpt-image-2',
    pollMs: Math.max(20, Number(env.AICLONE_POLL_MS) || 2000),
  },
  audio: {
    baseUrl: (env.INDEXTTS_BASE_URL || 'http://127.0.0.1:7860').replace(/\/+$/, ''),
    endpoint: env.INDEXTTS_ENDPOINT || 'gen_single',
    inferMode: '普通推理',
    timeoutMs: Math.max(30000, Number(env.INDEXTTS_TIMEOUT_MS) || 600000),
    concurrency: Math.max(1, Math.min(4, Number(env.AUDIO_CONCURRENCY) || 1)),
    voiceDir: path.join(dataDir, 'voice'),
  },
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
