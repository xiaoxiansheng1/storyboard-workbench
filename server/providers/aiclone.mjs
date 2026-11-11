import { downloadImage } from './download.mjs';
import { timeoutSignal } from './signal.mjs';
import { delay, withRetry } from '../utils/retry.mjs';
import { errorText } from '../utils/message.mjs';

export const AICLONE_MODELS = [
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    note: '细节与文字更稳，最多 4 张参考图',
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Gemini 3.1 Flash Image',
    note: '出图更快，最多 14 张参考图',
  },
];

const RATIOS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16']);

export function toImageRatio(size) {
  const raw = String(size || '').trim();
  if (RATIOS.has(raw)) return raw;
  const matched = /^(\d+)\s*[x×:]\s*(\d+)$/i.exec(raw);
  if (!matched) return '16:9';
  const width = Number(matched[1]);
  const height = Number(matched[2]);
  if (!width || !height) return '16:9';
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.05) return '1:1';
  if (Math.abs(ratio - 4 / 3) < 0.05) return '4:3';
  if (Math.abs(ratio - 3 / 4) < 0.05) return '3:4';
  return width > height ? '16:9' : '9:16';
}

function findImageUrl(payload) {
  const candidates = [
    payload?.imageUrl,
    payload?.image_url,
    payload?.url,
    payload?.data?.imageUrl,
    payload?.data?.image_url,
    payload?.data?.url,
    payload?.result?.imageUrl,
    payload?.result?.image_url,
    payload?.result?.url,
    Array.isArray(payload?.images) ? payload.images[0] : undefined,
    Array.isArray(payload?.data?.images) ? payload.data.images[0] : undefined,
    Array.isArray(payload?.output) ? payload.output[0] : undefined,
  ];
  for (const item of candidates) {
    if (typeof item === 'string' && item) return item;
    if (item && typeof item.url === 'string' && item.url) return item.url;
  }
  return '';
}

function readState(payload) {
  const url = findImageUrl(payload);
  const rawStatus = payload?.status ?? payload?.data?.status ?? payload?.state ?? payload?.data?.state;
  const status = String(rawStatus || '').toLowerCase();
  if (url) return { url, status: 'completed' };
  if (/(failed|failure|error|cancel|expired|reject)/.test(status)) {
    const message =
      (typeof payload?.error === 'string' ? payload.error : payload?.error?.message) ||
      payload?.message ||
      `任务状态 ${status}`;
    return { url: '', status: 'failed', message };
  }
  return { url: '', status: status || 'pending' };
}

export function createAicloneProvider(config, initialModel) {
  let model = AICLONE_MODELS.some((item) => item.id === initialModel)
    ? initialModel
    : AICLONE_MODELS[0].id;

  const apiKey = () => String(config.aiclone.apiKey || '').trim();

  async function request(path, init, signal) {
    const key = apiKey();
    if (!key) throw new Error('未配置 AICLONE_API_KEY，请在「系统设置」中填写');

    const res = await fetch(`${config.aiclone.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...(init?.headers || {}),
      },
      signal: timeoutSignal(config.timeoutMs, signal),
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${errorText(json, text)}`);
    if (!json || typeof json !== 'object') {
      throw new Error(`接口返回的不是 JSON：${text.slice(0, 200)}`);
    }
    return json;
  }

  async function resolveImage(url, ratio, signal) {
    const absolute = url.startsWith('data:')
      ? url
      : new URL(url, `${config.aiclone.baseUrl}/`).toString();
    const image = await downloadImage(absolute, config.timeoutMs, signal);
    return { ...image, size: ratio };
  }

  async function generate({ prompt, size, seed, signal }) {
    const ratio = toImageRatio(size);
    const body = { prompt, model, size: ratio };
    if (config.requestSeed && seed !== undefined) body.seed = seed;

    const created = await request(
      '/api/v2/image/generate',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      signal,
    );

    const taskId =
      created.task_id ||
      created.taskId ||
      created.id ||
      created.data?.task_id ||
      created.data?.taskId ||
      created.data?.id;
    const initial = readState(created);

    if (initial.url) return resolveImage(initial.url, ratio, signal);
    if (initial.status === 'failed') {
      throw new Error(`生成失败：${initial.message || '供应商返回失败状态'}`);
    }
    if (!taskId) {
      throw new Error(`接口没有返回 task_id：${JSON.stringify(created).slice(0, 300)}`);
    }

    const deadline = Date.now() + config.timeoutMs;
    let lastStatus = initial.status;
    while (Date.now() < deadline) {
      await delay(Math.min(config.aiclone.pollMs, deadline - Date.now()));
      if (signal?.aborted) throw new Error('已取消');
      if (Date.now() >= deadline) break;

      const payload = await withRetry(() =>
        request(`/api/v2/tasks/${encodeURIComponent(taskId)}`, { method: 'GET' }, signal),
      );
      const state = readState(payload);
      lastStatus = state.status;
      if (state.url) return resolveImage(state.url, ratio, signal);
      if (state.status === 'failed') {
        throw new Error(`生成失败：${state.message || '供应商返回失败状态'}`);
      }
    }

    throw new Error(
      `生成超时（${Math.round(config.timeoutMs / 1000)} 秒），任务 ${taskId} 最后状态 ${lastStatus}`,
    );
  }

  return {
    name: 'aiclone',
    models: AICLONE_MODELS,
    get model() {
      return model;
    },
    set model(next) {
      if (AICLONE_MODELS.some((item) => item.id === next)) model = next;
    },
    generate,
  };
}
