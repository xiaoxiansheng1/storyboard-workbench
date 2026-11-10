import fs from 'node:fs';
import path from 'node:path';
import { extFromMime, sniffExt } from '../assets.mjs';
import { timeoutSignal } from './signal.mjs';

const DEFAULTS = {
  inferMode: '普通推理',
  maxTextTokensPerSentence: 120,
  sentencesBucketMaxSize: 4,
  doSample: true,
  topP: 0.8,
  topK: 30,
  temperature: 1,
  lengthPenalty: 0,
  numBeams: 3,
  repetitionPenalty: 10,
  maxMelTokens: 600,
};

const AUDIO_MIME = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  weba: 'audio/webm',
};

function errorText(json, text) {
  if (typeof json?.error === 'string') return json.error;
  if (json?.error?.message) return json.error.message;
  if (typeof json?.detail === 'string') return json.detail;
  return String(text || '').slice(0, 300);
}

export function createIndexTTSProvider(config) {
  const uploads = new Map();

  function base() {
    return String(config.audio.baseUrl || '').replace(/\/+$/, '');
  }

  function cacheKey(voice) {
    return `${base()}|${voice.path}|${voice.updatedAt || ''}`;
  }

  async function uploadReference(voice, signal) {
    const key = cacheKey(voice);
    if (uploads.has(key)) return uploads.get(key);

    const data = await fs.promises.readFile(voice.path);
    const form = new FormData();
    form.append(
      'files',
      new Blob([data], { type: voice.mime || 'audio/wav' }),
      voice.name || path.basename(voice.path),
    );
    const res = await fetch(`${base()}/gradio_api/upload`, {
      method: 'POST',
      body: form,
      signal: timeoutSignal(60000, signal),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`上传参考音频失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`上传参考音频返回异常：${text.slice(0, 200)}`);
    }
    const serverPath = Array.isArray(parsed)
      ? parsed[0]
      : typeof parsed === 'string'
        ? parsed
        : parsed?.files?.[0] || parsed?.path;
    if (typeof serverPath !== 'string' || !serverPath) {
      throw new Error(`上传参考音频没有返回路径：${text.slice(0, 200)}`);
    }
    const fileData = {
      path: serverPath,
      orig_name: voice.name || path.basename(voice.path),
      mime_type: voice.mime || 'audio/wav',
      meta: { _type: 'gradio.FileData' },
    };
    uploads.set(key, fileData);
    return fileData;
  }

  async function call(pathname, body, signal) {
    const res = await fetch(`${base()}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeoutSignal(60000, signal),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${errorText(json, text)}`);
    if (!json) throw new Error(`接口返回异常：${text.slice(0, 200)}`);
    return json;
  }

  async function readEvents(eventId, signal) {
    const res = await fetch(
      `${base()}/gradio_api/call/${config.audio.endpoint}/${encodeURIComponent(eventId)}`,
      {
        headers: { Accept: 'text/event-stream' },
        signal: timeoutSignal(config.audio.timeoutMs, signal),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`读取生成结果失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.body) throw new Error('接口没有返回事件流');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastData = '';

    const handleBlock = (block) => {
      const lines = block.split('\n');
      let event = 'message';
      const data = [];
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (!data.length) return null;
      const raw = data.join('\n');
      lastData = raw;
      if (event === 'error') {
        let message = raw;
        try {
          const parsed = JSON.parse(raw);
          message = errorText(parsed, raw);
        } catch {
          // 保留原始错误文本
        }
        throw new Error(`生成失败：${message}`);
      }
      if (event === 'complete' || event === 'message') {
        try {
          return JSON.parse(raw);
        } catch {
          return { value: raw };
        }
      }
      return null;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let index = buffer.indexOf('\n\n');
        while (index >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const result = handleBlock(block);
          if (result !== null) {
            await reader.cancel();
            return result;
          }
          index = buffer.indexOf('\n\n');
        }
      }
      if (buffer.trim()) {
        const result = handleBlock(buffer);
        if (result !== null) return result;
      }
    } finally {
      reader.releaseLock?.();
    }
    throw new Error(lastData ? `生成结果异常：${lastData.slice(0, 200)}` : '接口没有返回生成结果');
  }

  function pickFile(value, depth = 0) {
    if (value == null || depth > 5) return null;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return null;
      return /^https?:\/\//i.test(text) ? { url: text } : { path: text };
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = pickFile(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof value !== 'object') return null;
    if (typeof value.url === 'string' && value.url) return value;
    if (typeof value.path === 'string' && value.path) return value;
    for (const key of ['value', 'data', 'files', 'file']) {
      if (key in value) {
        const hit = pickFile(value[key], depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  async function download(file, signal) {
    const hasUrl = typeof file?.url === 'string' && file.url;
    const hasPath = typeof file?.path === 'string' && file.path;
    if (!hasUrl && !hasPath) throw new Error('生成结果里没有音频文件');
    const url = hasUrl
      ? new URL(file.url, `${base()}/`).toString()
      : `${base()}/gradio_api/file=${encodeURI(file.path)}`;
    const res = await fetch(url, { signal: timeoutSignal(120000, signal) });
    if (!res.ok) throw new Error(`下载生成音频失败 HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    let mime =
      (typeof file.mime_type === 'string' && file.mime_type) ||
      String(res.headers.get('content-type') || '').split(';')[0].trim() ||
      '';
    const ext = extFromMime(mime, '') || sniffExt(data);
    if (!mime.toLowerCase().startsWith('audio/')) {
      mime = AUDIO_MIME[ext] || 'audio/wav';
    }
    return { data, mime, ext };
  }

  async function once({ text, voice, signal }) {
    const fileData = await uploadReference(voice, signal);
    const created = await call(`/gradio_api/call/${config.audio.endpoint}`, {
      data: [
        fileData,
        text,
        config.audio.inferMode || DEFAULTS.inferMode,
        DEFAULTS.maxTextTokensPerSentence,
        DEFAULTS.sentencesBucketMaxSize,
        DEFAULTS.doSample,
        DEFAULTS.topP,
        DEFAULTS.topK,
        DEFAULTS.temperature,
        DEFAULTS.lengthPenalty,
        DEFAULTS.numBeams,
        DEFAULTS.repetitionPenalty,
        DEFAULTS.maxMelTokens,
      ],
    }, signal);
    const eventId = created.event_id || created.eventId;
    if (!eventId) throw new Error(`接口没有返回 event_id：${JSON.stringify(created).slice(0, 200)}`);
    const result = await readEvents(eventId, signal);
    const file = pickFile(result);
    if (!file) throw new Error(`生成结果里没有音频文件：${JSON.stringify(result).slice(0, 200)}`);
    return download(file, signal);
  }

  async function generate({ text, voice, signal }) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await once({ text, voice, signal });
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw error;
        // Gradio 重启后旧的临时文件路径会失效，重新上传一次再试
        if (attempt === 0) {
          uploads.delete(cacheKey(voice));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  async function health(override) {
    const target = String(override || base()).replace(/\/+$/, '');
    try {
      const res = await fetch(`${target}/config`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      return {
        ok: true,
        title: data.title || 'IndexTTS',
        version: data.version || '',
      };
    } catch (error) {
      const code = error?.cause?.code || error?.code;
      const message =
        error?.name === 'TimeoutError'
          ? '连接超时'
          : code === 'ECONNREFUSED'
            ? '无法连接，请确认服务已启动'
            : code === 'ENOTFOUND' || code === 'EAI_AGAIN'
              ? '无法解析服务地址'
              : error?.cause?.message || error?.message || String(error);
      return { ok: false, error: message };
    }
  }

  return { name: 'indextts', model: 'IndexTTS', generate, health };
}
