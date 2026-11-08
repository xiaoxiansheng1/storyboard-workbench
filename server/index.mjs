import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { ProjectManager, ID_PATTERN } from './projects.mjs';
import { parseCsv } from './csv.mjs';
import { buildProject } from './import.mjs';
import { createProvider } from './providers/index.mjs';
import { createIndexTTSProvider } from './providers/indextts.mjs';
import { AICLONE_MODELS } from './providers/aiclone.mjs';
import { Settings, SETTING_LIMITS } from './settings.mjs';
import { hashPrompt } from './hash.mjs';
import { saveAsset } from './assets.mjs';
import { audioPeaks, extractPoster, probeVideo, probeAudio } from './video.mjs';
import { VoiceStore } from './voice.mjs';
import {
  audioLane,
  audioPosition,
  createAudioNode,
  firstFreeAudioPosition,
  hashAudio,
  nextAudioNo,
  renumberAudio,
  splitAudioText,
} from './audio.mjs';

const settings = new Settings(config.dataDir);
if (settings.data.apiKey) config.aiclone.apiKey = settings.data.apiKey;
if (settings.data.promptLang === 'zh' || settings.data.promptLang === 'en') {
  config.promptLang = settings.data.promptLang;
}
if (settings.data.audioBaseUrl) {
  config.audio.baseUrl = settings.data.audioBaseUrl.replace(/\/+$/, '');
}
for (const key of Object.keys(SETTING_LIMITS)) {
  if (Number.isInteger(settings.data[key])) config[key] = settings.data[key];
}

const voice = new VoiceStore(config.audio.voiceDir);
const audioProvider = createIndexTTSProvider(config);

function audioPayload() {
  const current = voice.get();
  return {
    baseUrl: config.audio.baseUrl,
    hasVoice: current.exists,
    voiceName: current.name,
    voiceDurationSec: current.durationSec,
    voiceUpdatedAt: current.updatedAt,
    voiceUrl: current.exists
      ? `/api/voice/file?v=${encodeURIComponent(current.updatedAt || '')}`
      : null,
  };
}

const PROVIDER_LABELS = { mock: '本地占位', aiclone: 'AIClone', openai: 'OpenAI 兼容' };
const LIMIT_LABELS = { concurrency: '并发数', dailyCap: '每日生成上限', maxBatch: '单次批量上限' };
const DEFAULT_PROJECT_NAME = '未命名项目';
const providerCache = new Map();

function providerName() {
  const saved = settings.data.provider;
  if (saved === 'mock' || saved === 'aiclone' || saved === 'openai') return saved;
  if (config.provider === 'auto') return 'aiclone';
  return config.provider;
}

function currentProvider() {
  const name = providerName();
  if (!providerCache.has(name)) {
    providerCache.set(name, createProvider(config, name, settings.data.imageModel));
  }
  const provider = providerCache.get(name);
  if (provider.name === 'aiclone' && settings.data.imageModel) provider.model = settings.data.imageModel;
  return provider;
}

function maskKey(key) {
  const value = String(key || '');
  if (!value) return '';
  if (value.length <= 10) return `${value.slice(0, 2)}****`;
  return `${value.slice(0, 5)}****${value.slice(-4)}`;
}

function providerHasKey(provider) {
  if (provider.name === 'mock') return true;
  if (provider.name === 'aiclone') return Boolean(config.aiclone.apiKey);
  return Boolean(config.openai.apiKey || Object.keys(config.openai.extraHeaders).length);
}

const clients = new Set();
function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}

const projects = new ProjectManager({
  dataDir: config.dataDir,
  config,
  getProvider: currentProvider,
  getAudioProvider: () => audioProvider,
  getVoice: () => voice.get(),
  broadcast,
});

const MISSING_KEY_ERROR = /未配置\s*AICLONE_API_KEY/;
const CREDENTIAL_ERROR = /未配置\s*AICLONE_API_KEY|HTTP\s*(401|402|403)|unauthorized|invalid.{0,20}key/i;

function clearCredentialErrors(matcher) {
  if (!providerHasKey(currentProvider())) return 0;
  let changed = 0;
  for (const runtime of projects.openAll()) {
    let touched = false;
    for (const node of runtime.store.data.nodes) {
      const run = node.data?.run;
      if (run?.status !== 'error' || !run.error || !matcher.test(run.error)) continue;
      node.data.run = {
        ...run,
        status: run.candidates.length ? 'done' : 'idle',
        error: null,
        signature: '',
        progress: null,
        updatedAt: new Date().toISOString(),
      };
      broadcast({ type: 'run', projectId: runtime.id, nodeId: node.id, run: node.data.run });
      touched = true;
      changed += 1;
    }
    if (touched) runtime.store.save();
  }
  return changed;
}

// 之前因缺少 Key 失败的镜头，在 Key 就绪后不应继续显示旧报错
clearCredentialErrors(MISSING_KEY_ERROR);

function publicConfig(store) {
  const provider = currentProvider();
  return {
    provider: provider.name,
    providerLabel: PROVIDER_LABELS[provider.name] || provider.name,
    model: provider.model,
    models: provider.models || [],
    size: config.openai.size,
    promptLang: config.promptLang,
    appendNegative: config.appendNegative,
    dailyCap: config.dailyCap,
    usage: store ? store.usageCount() : 0,
    concurrency: config.concurrency,
    maxBatch: config.maxBatch,
    hasKey: providerHasKey(provider),
    keyHint: maskKey(config.aiclone.apiKey),
    audio: audioPayload(),
  };
}

function settingsPayload(store) {
  const provider = currentProvider();
  return {
    provider: provider.name,
    providerLabel: PROVIDER_LABELS[provider.name] || provider.name,
    imageModel:
      provider.name === 'aiclone'
        ? provider.model
        : settings.data.imageModel || config.aiclone.model,
    models: AICLONE_MODELS,
    hasKey: Boolean(config.aiclone.apiKey),
    keyHint: maskKey(config.aiclone.apiKey),
    promptLang: config.promptLang,
    size: config.openai.size,
    dailyCap: config.dailyCap,
    usage: store ? store.usageCount() : 0,
    concurrency: config.concurrency,
    maxBatch: config.maxBatch,
    audio: audioPayload(),
  };
}

function projectPayload(runtime) {
  return {
    meta: runtime.store.data.meta,
    nodes: runtime.store.data.nodes,
    edges: runtime.store.data.edges,
    config: publicConfig(runtime.store),
  };
}

function queryRuntime(req) {
  const id = typeof req.query.projectId === 'string' ? req.query.projectId : '';
  return id ? projects.open(id) : null;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64mb' }));

app.get('/api/health', (req, res) => {
  const provider = currentProvider();
  res.json({
    ok: true,
    provider: provider.name,
    model: provider.model,
    projects: projects.list().length,
  });
});

app.get('/api/projects', (req, res) => {
  res.json({ projects: projects.list() });
});

app.post('/api/projects', (req, res) => {
  const project = projects.create(req.body?.name);
  res.json({ project });
});

app.patch('/api/projects/:projectId', (req, res) => {
  const project = projects.rename(req.params.projectId, req.body?.name);
  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json({ project });
});

app.delete('/api/projects/:projectId', (req, res) => {
  const target = projects.remove(req.params.projectId);
  if (!target) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  res.json({ ok: true });
});

app.get('/api/settings', (req, res) => {
  res.json(settingsPayload(queryRuntime(req)?.store));
});

app.patch('/api/settings', (req, res) => {
  const body = req.body || {};
  const patch = {};

  if (body.provider === 'aiclone' || body.provider === 'mock') {
    patch.provider = body.provider;
  }
  if (typeof body.imageModel === 'string') {
    if (!AICLONE_MODELS.some((model) => model.id === body.imageModel)) {
      res.status(400).json({ error: '不支持的生图模型' });
      return;
    }
    patch.imageModel = body.imageModel;
  }
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    patch.apiKey = body.apiKey.trim();
  }
  if (body.promptLang === 'zh' || body.promptLang === 'en') {
    patch.promptLang = body.promptLang;
  }
  if (typeof body.audioBaseUrl === 'string') {
    const value = body.audioBaseUrl.trim().replace(/\/+$/, '');
    if (value && !/^https?:\/\//i.test(value)) {
      res.status(400).json({ error: 'IndexTTS 地址需以 http:// 或 https:// 开头' });
      return;
    }
    patch.audioBaseUrl = value || 'http://127.0.0.1:7860';
  }
  for (const key of Object.keys(SETTING_LIMITS)) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    const [min, max] = SETTING_LIMITS[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      res.status(400).json({ error: `${LIMIT_LABELS[key]}需为 ${min}-${max} 的整数` });
      return;
    }
    patch[key] = value;
  }
  if (!Object.keys(patch).length) {
    res.status(400).json({ error: '没有可保存的设置' });
    return;
  }

  settings.patch(patch);
  if (patch.apiKey) config.aiclone.apiKey = patch.apiKey;
  if (patch.promptLang) config.promptLang = patch.promptLang;
  if (patch.audioBaseUrl) config.audio.baseUrl = patch.audioBaseUrl;
  for (const key of Object.keys(SETTING_LIMITS)) {
    if (patch[key] !== undefined) config[key] = patch[key];
  }
  const provider = currentProvider();
  if (patch.imageModel && provider.name === 'aiclone') provider.model = patch.imageModel;
  if (patch.apiKey) clearCredentialErrors(CREDENTIAL_ERROR);
  if (patch.concurrency !== undefined) {
    for (const runtime of projects.runtimes.values()) runtime.jobs.refresh();
  }

  broadcast({ type: 'settings', config: publicConfig(null) });
  const store = queryRuntime(req)?.store;
  res.json({ settings: settingsPayload(store), config: publicConfig(store) });
});

app.get('/api/audio/health', async (req, res) => {
  const raw = typeof req.query.baseUrl === 'string' ? req.query.baseUrl.trim() : '';
  const baseUrl = raw ? raw.replace(/\/+$/, '') : config.audio.baseUrl;
  if (raw && !/^https?:\/\//i.test(raw)) {
    res.status(400).json({ ok: false, baseUrl, error: '地址需以 http:// 或 https:// 开头' });
    return;
  }
  res.json({ ...(await audioProvider.health(baseUrl)), baseUrl });
});

const VOICE_MAX_BYTES = 32 * 1024 * 1024;
const voiceBody = express.raw({
  type: ['audio/*', 'application/octet-stream'],
  limit: VOICE_MAX_BYTES,
});

app.post('/api/voice', voiceBody, async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ error: '没有收到参考音频' });
    return;
  }
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('audio/') && mime !== 'application/octet-stream') {
    res.status(400).json({ error: '请选择 WAV / MP3 / M4A / FLAC / OGG 音频' });
    return;
  }
  fs.mkdirSync(config.audio.voiceDir, { recursive: true });
  const tmp = path.join(config.audio.voiceDir, `upload-${Date.now().toString(36)}.tmp`);
  try {
    fs.writeFileSync(tmp, req.body);
    const meta = await probeAudio(config.ffprobePath, tmp);
    const rawName = req.headers['x-file-name'];
    let originalName = 'reference.wav';
    if (rawName) {
      try {
        originalName = decodeURIComponent(String(rawName));
      } catch {
        originalName = String(rawName);
      }
    }
    const saved = voice.save({ data: req.body, mime, originalName });
    voice.setMeta({
      filename: saved.filename,
      name: originalName,
      mime: mime === 'application/octet-stream' ? saved.mime : mime,
      durationSec: meta.durationSec,
    });
    res.json({ audio: audioPayload() });
  } catch (error) {
    res.status(400).json({ error: `无法读取参考音频：${error.message}` });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

app.get('/api/voice/file', (req, res) => {
  const current = voice.get();
  if (!current.exists) {
    res.status(404).json({ error: '还没有参考音频' });
    return;
  }
  res.set('Cache-Control', 'private, max-age=3600');
  res.type(current.mime || 'audio/wav');
  res.sendFile(current.path);
});

app.delete('/api/voice', (req, res) => {
  voice.clear();
  res.json({ audio: audioPayload() });
});

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`retry: 3000\n\n`);
  clients.add(res);
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(ping);
      clients.delete(res);
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

const UPLOAD_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);
const UPLOAD_MAX_BYTES = 32 * 1024 * 1024;
const imageBody = express.raw({
  type: ['image/*', 'application/octet-stream'],
  limit: UPLOAD_MAX_BYTES,
});

const VIDEO_MAX_BYTES = 256 * 1024 * 1024;
const videoBody = express.raw({
  type: ['video/*', 'application/octet-stream'],
  limit: VIDEO_MAX_BYTES,
});

function removeVideoAssets(store, nodeId, video) {
  if (!video) return;
  const names = [video.filename, video.posterUrl ? path.basename(video.posterUrl.split('?')[0]) : ''];
  for (const name of names) {
    if (!name) continue;
    try {
      fs.rmSync(path.join(store.assetsDir, nodeId, name), { force: true });
    } catch {
      // 文件已被删除时忽略
    }
  }
}

function roundSeconds(value) {
  return Math.round(value * 1000) / 1000;
}

async function writeVideoPoster(runtime, nodeId, video, atSec) {
  const source = path.join(runtime.store.assetsDir, nodeId, video.filename);
  const posterName = `${video.filename.replace(/\.[^.]+$/, '')}-poster.jpg`;
  const posterPath = path.join(runtime.store.assetsDir, nodeId, posterName);
  const tmpPath = `${posterPath}.${Date.now().toString(36)}.tmp`;
  try {
    await extractPoster(config.ffmpegPath, source, tmpPath, atSec);
    fs.renameSync(tmpPath, posterPath);
    // 海报是同名覆盖，/assets 又是长缓存，靠 query 版本号让浏览器重新拉取
    video.posterUrl = `${runtime.assetBase}/${nodeId}/${posterName}?v=${Date.now().toString(36)}`;
  } catch {
    // 抽帧失败不影响视频使用，节点会退回首帧或占位图
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

const projectRouter = express.Router({ mergeParams: true });

projectRouter.use((req, res, next) => {
  const runtime = projects.open(req.params.projectId);
  if (!runtime) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }
  req.project = runtime;
  next();
});

projectRouter.get('/project', (req, res) => {
  res.json(projectPayload(req.project));
});

projectRouter.post('/usage/reset', (req, res) => {
  res.json({ usage: req.project.store.resetUsage() });
});

projectRouter.post('/import', (req, res) => {
  const { store } = req.project;
  const { csv, name, sourceFile } = req.body || {};
  if (typeof csv !== 'string' || !csv.trim()) {
    res.status(400).json({ error: '缺少 CSV 文本' });
    return;
  }

  try {
    const rows = parseCsv(csv);
    const built = buildProject(rows, { name, sourceFile });
    if (!built.nodes.length) {
      res.status(400).json({ error: '没有解析出任何镜头', stats: built.stats });
      return;
    }

    const previous = new Map(store.data.nodes.map((n) => [n.id, n]));
    let reused = 0;
    for (const node of built.nodes) {
      const old = previous.get(node.id);
      if (
        old &&
        old.data.promptHash === node.data.promptHash &&
        Array.isArray(old.data.run?.candidates) &&
        old.data.run.candidates.length
      ) {
        node.data.run = old.data.run;
        reused += 1;
      }
    }

    const meta = { ...built.meta };
    const currentName = store.data.meta?.name;
    if (currentName && currentName !== DEFAULT_PROJECT_NAME) meta.name = currentName;

    // 音频节点独立于镜头，导入分镜只替换镜头，不删除已有音频
    const audioNodes = store.data.nodes.filter((node) => node.type === 'audio');
    const lane = audioLane(built.nodes);
    if (audioNodes.some((node) => (Number(node.position?.y) || 0) < lane)) {
      const taken = [];
      const ordered = [...audioNodes].sort((a, b) => a.data.no - b.data.no);
      for (const node of ordered) {
        node.position = firstFreeAudioPosition(taken, lane);
        taken.push(node.position);
      }
    }
    store.replaceProject({ nodes: [...built.nodes, ...audioNodes], edges: built.edges, meta });
    res.json({
      project: projectPayload(req.project),
      stats: { ...built.stats, reused },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

projectRouter.patch('/nodes/:id', (req, res) => {
  const { store } = req.project;
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
    return;
  }

  const body = req.body || {};
  if (body.position && Number.isFinite(Number(body.position.x)) && Number.isFinite(Number(body.position.y))) {
    node.position = { x: Number(body.position.x), y: Number(body.position.y) };
  }

  if (node.type !== 'audio') {
    const fields = ['caption', 'promptZh', 'promptEn', 'negativeZh', 'negativeEn', 'videoPrompt'];
    let promptsChanged = false;
    for (const field of fields) {
      if (typeof body[field] === 'string' && body[field] !== node.data[field]) {
        node.data[field] = body[field];
        if (field.startsWith('prompt') || field.startsWith('negative')) promptsChanged = true;
      }
    }
    if (promptsChanged) node.data.promptHash = hashPrompt(node.data);
  }

  store.save();
  res.json({ node });
});

projectRouter.post('/nodes/:id/generate', (req, res) => {
  const { store, jobs } = req.project;
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
    return;
  }
  if (node.type === 'audio') {
    res.status(400).json({ error: '这是音频节点，请使用音频生成接口' });
    return;
  }
  const result = jobs.enqueue([node.id], req.body || {});
  res.json({ ...result, node });
});

projectRouter.post('/nodes/:id/select', (req, res) => {
  const { store } = req.project;
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
    return;
  }
  if (node.type === 'audio') {
    res.status(400).json({ error: '这是音频节点，请使用音频候选接口' });
    return;
  }
  const candidateId = String(req.body?.candidateId || '');
  const exists = node.data.run.candidates.some((c) => c.id === candidateId);
  if (!exists) {
    res.status(400).json({ error: '候选图不存在' });
    return;
  }
  node.data.run.selectedId = candidateId;
  node.data.run.updatedAt = new Date().toISOString();
  store.save();
  res.json({ node });
});

projectRouter.post('/nodes/:id/upload', imageBody, (req, res) => {
  const { store, assetBase } = req.project;
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
    return;
  }

  if (node.type === 'audio') {
    res.status(400).json({ error: '音频节点不能上传首帧' });
    return;
  }
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ error: '没有收到图片文件' });
    return;
  }
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!UPLOAD_MIMES.has(mime)) {
    res.status(400).json({ error: '请选择 PNG / JPG / WebP / GIF / AVIF 图片' });
    return;
  }

  const asset = saveAsset(store.assetsDir, node.id, { data: req.body, mime }, assetBase);
  const run = node.data.run;
  const candidate = {
    id: asset.id,
    url: asset.url,
    filename: asset.filename,
    seed: null,
    size: '',
    provider: 'upload',
    model: 'local',
    promptHash: node.data.promptHash,
    createdAt: new Date().toISOString(),
  };
  run.candidates.push(candidate);
  run.selectedId = candidate.id;
  run.promptHash = node.data.promptHash;
  run.status = 'done';
  run.error = null;
  run.progress = null;
  run.updatedAt = candidate.createdAt;
  store.save();
  broadcast({ type: 'run', projectId: req.project.id, nodeId: node.id, run });
  res.json({ node, candidate });
});

projectRouter.delete('/nodes/:id/run', (req, res) => {
  const { store } = req.project;
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
    return;
  }
  if (node.type === 'audio') {
    res.status(400).json({ error: '这是音频节点，请使用音频清空接口' });
    return;
  }
  node.data.run = {
    status: 'idle',
    candidates: [],
    selectedId: null,
    error: null,
    signature: '',
    promptHash: '',
    progress: null,
    updatedAt: new Date().toISOString(),
  };
  store.save();
  broadcast({ type: 'run', projectId: req.project.id, nodeId: node.id, run: node.data.run });
  res.json({ node });
});

projectRouter.post('/nodes/:id/video', videoBody, async (req, res) => {
  const runtime = req.project;
  const { store, assetBase } = runtime;
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
    return;
  }
  if (node.type === 'audio') {
    res.status(400).json({ error: '音频节点不能上传镜头视频' });
    return;
  }
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ error: '没有收到视频文件' });
    return;
  }
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('video/') && mime !== 'application/octet-stream') {
    res.status(400).json({ error: '请选择 MP4 / MOV / WebM 等视频文件' });
    return;
  }

  const asset = saveAsset(store.assetsDir, node.id, { data: req.body, mime }, assetBase);
  const source = path.join(store.assetsDir, node.id, asset.filename);
  let meta;
  try {
    meta = await probeVideo(config.ffprobePath, source);
  } catch (error) {
    fs.rmSync(source, { force: true });
    res.status(400).json({ error: `无法读取视频：${error.message}` });
    return;
  }

  removeVideoAssets(store, node.id, node.data.video);
  const video = {
    filename: asset.filename,
    url: asset.url,
    posterUrl: null,
    durationSec: roundSeconds(meta.durationSec),
    width: meta.width,
    height: meta.height,
    fps: Math.round(meta.fps * 100) / 100,
    inPoint: 0,
    addedAt: new Date().toISOString(),
  };
  await writeVideoPoster(runtime, node.id, video, Math.min(0.1, meta.durationSec / 2));
  node.data.video = video;
  store.save();
  res.json({ node, video });
});

projectRouter.patch('/nodes/:id/video', async (req, res) => {
  const runtime = req.project;
  const { store } = runtime;
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
    return;
  }
  if (node.type === 'audio') {
    res.status(400).json({ error: '音频节点没有镜头视频' });
    return;
  }
  const video = node.data.video;
  if (!video) {
    res.status(404).json({ error: '该镜头还没有上传视频' });
    return;
  }
  const value = Number(req.body?.inPoint);
  if (!Number.isFinite(value) || value < 0) {
    res.status(400).json({ error: '起点需为不小于 0 的秒数' });
    return;
  }
  const max = Math.max(0, video.durationSec - 0.1);
  video.inPoint = roundSeconds(Math.min(value, max));
  await writeVideoPoster(runtime, node.id, video, video.inPoint + 0.05);
  node.data.video = video;
  store.save();
  res.json({ node });
});

projectRouter.delete('/nodes/:id/video', (req, res) => {
  const { store } = req.project;
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
    return;
  }
  if (node.type === 'audio') {
    res.status(400).json({ error: '音频节点没有镜头视频' });
    return;
  }
  removeVideoAssets(store, node.id, node.data.video);
  node.data.video = null;
  store.save();
  res.json({ node });
});

projectRouter.post('/generate/batch', (req, res) => {
  const { store, jobs } = req.project;
  const body = req.body || {};
  const scope = body.scope === 'all' ? 'all' : 'missing';
  const nodes = store.data.nodes.filter((node) => node.type !== 'audio');
  const shotIds = new Set(nodes.map((node) => node.id));
  const ids = (Array.isArray(body.nodeIds) && body.nodeIds.length
    ? body.nodeIds
    : nodes
        .filter((node) => {
          if (scope === 'all') return true;
          const run = node.data.run;
          const stale = run.promptHash !== node.data.promptHash;
          return stale || run.status === 'error' || run.candidates.length === 0;
        })
        .map((node) => node.id)
  ).filter((id) => shotIds.has(id));

  if (ids.length > config.maxBatch) {
    res.status(400).json({
      error: `单次批量最多 ${config.maxBatch} 个镜头，当前请求 ${ids.length} 个`,
      maxBatch: config.maxBatch,
      requested: ids.length,
    });
    return;
  }

  const result = jobs.enqueue(ids, body);
  res.json({ ...result, total: ids.length });
});

function findAudioNode(req, res) {
  const node = req.project.store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '音频节点不存在' });
    return null;
  }
  if (node.type !== 'audio') {
    res.status(400).json({ error: '不是音频节点' });
    return null;
  }
  return node;
}

projectRouter.post('/audio/split', (req, res) => {
  const chunks = splitAudioText(req.body?.text, req.body?.chunkChars);
  if (!chunks.length) {
    res.status(400).json({ error: '没有可拆分的文本' });
    return;
  }
  res.json({
    chunks,
    chars: chunks.reduce((sum, item) => sum + item.length, 0),
  });
});

projectRouter.post('/audio/nodes/batch', (req, res) => {
  const { store } = req.project;
  const texts = Array.isArray(req.body?.texts) ? req.body.texts : [];
  const cleaned = texts.map((item) => String(item || '').trim()).filter(Boolean);
  if (!cleaned.length) {
    res.status(400).json({ error: '没有可创建的文本' });
    return;
  }
  const nodes = [];
  let no = nextAudioNo(store.data.nodes);
  for (const text of cleaned) {
    const node = createAudioNode({
      no: no++,
      text,
      position: audioPosition([...store.data.nodes, ...nodes]),
    });
    nodes.push(node);
  }
  for (const node of nodes) store.addNode(node);
  res.json({ nodes });
});

projectRouter.post('/audio/nodes', (req, res) => {
  const { store } = req.project;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: '文本不能为空' });
    return;
  }
  const node = createAudioNode({
    no: nextAudioNo(store.data.nodes),
    text,
    position: audioPosition(store.data.nodes),
  });
  store.addNode(node);
  res.json({ node });
});

projectRouter.patch('/audio/nodes/:id', (req, res) => {
  const node = findAudioNode(req, res);
  if (!node) return;
  const { store } = req.project;
  const body = req.body || {};
  if (body.position && Number.isFinite(Number(body.position.x)) && Number.isFinite(Number(body.position.y))) {
    node.position = { x: Number(body.position.x), y: Number(body.position.y) };
  }
  if (typeof body.text === 'string') {
    const text = body.text.trim();
    if (!text) {
      res.status(400).json({ error: '文本不能为空' });
      return;
    }
    if (text !== node.data.text) {
      node.data.text = text;
      node.data.textHash = hashAudio(text);
    }
  }
  store.save();
  res.json({ node });
});

projectRouter.delete('/audio/nodes/:id', (req, res) => {
  const node = findAudioNode(req, res);
  if (!node) return;
  const { store } = req.project;
  store.removeNode(node.id);
  fs.rmSync(path.join(store.assetsDir, node.id), { recursive: true, force: true });
  const nodes = renumberAudio(store.data.nodes);
  store.save();
  res.json({ ok: true, removed: node.id, nodes });
});

projectRouter.post('/audio/nodes/:id/move', (req, res) => {
  const node = findAudioNode(req, res);
  if (!node) return;
  const { store } = req.project;
  const direction = req.body?.direction === 'up' ? -1 : 1;
  const ordered = renumberAudio(store.data.nodes);
  const index = ordered.findIndex((item) => item.id === node.id);
  const target = ordered[index + direction];
  if (!target) {
    res.json({ nodes: ordered });
    return;
  }
  const no = node.data.no;
  node.data.no = target.data.no;
  target.data.no = no;
  const position = node.position;
  node.position = target.position;
  target.position = position;
  store.save();
  res.json({ nodes: [node, target] });
});

projectRouter.post('/audio/nodes/:id/generate', (req, res) => {
  const node = findAudioNode(req, res);
  if (!node) return;
  try {
    const result = req.project.audioJobs.enqueue([node.id], req.body || {});
    res.json({ ...result, node });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

projectRouter.post('/audio/nodes/:id/select', (req, res) => {
  const node = findAudioNode(req, res);
  if (!node) return;
  const candidateId = String(req.body?.candidateId || '');
  if (!node.data.run.candidates.some((candidate) => candidate.id === candidateId)) {
    res.status(400).json({ error: '音频候选不存在' });
    return;
  }
  node.data.run.selectedId = candidateId;
  node.data.run.updatedAt = new Date().toISOString();
  req.project.store.save();
  broadcast({ type: 'audio-run', projectId: req.project.id, nodeId: node.id, run: node.data.run });
  res.json({ node });
});

projectRouter.delete('/audio/nodes/:id/run', (req, res) => {
  const node = findAudioNode(req, res);
  if (!node) return;
  const updated = req.project.audioJobs.clear(node.id);
  res.json({ node: updated });
});

projectRouter.get('/audio/nodes/:id/peaks', async (req, res) => {
  const node = findAudioNode(req, res);
  if (!node) return;
  const { store } = req.project;
  const candidates = node.data.run.candidates || [];
  const wanted = String(req.query.candidateId || '');
  const candidate =
    candidates.find((item) => item.id === wanted) ||
    candidates.find((item) => item.id === node.data.run.selectedId) ||
    candidates[candidates.length - 1];
  if (!candidate) {
    res.json({ peaks: [] });
    return;
  }
  if (Array.isArray(candidate.peaks) && candidate.peaks.length) {
    res.json({ peaks: candidate.peaks });
    return;
  }
  try {
    const peaks = await audioPeaks(
      config.ffmpegPath,
      path.join(store.assetsDir, node.id, candidate.filename),
    );
    candidate.peaks = peaks;
    store.save();
    res.json({ peaks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

projectRouter.post('/audio/generate/batch', (req, res) => {
  const { store, audioJobs } = req.project;
  const body = req.body || {};
  const audioNodes = store.data.nodes
    .filter((node) => node.type === 'audio')
    .sort((a, b) => Number(a.data.no) - Number(b.data.no));
  const ids = Array.isArray(body.nodeIds) && body.nodeIds.length
    ? body.nodeIds
    : audioNodes.map((node) => node.id);
  if (ids.length > config.maxBatch) {
    res.status(400).json({
      error: `单次批量最多 ${config.maxBatch} 个音频，当前请求 ${ids.length} 个`,
      maxBatch: config.maxBatch,
      requested: ids.length,
    });
    return;
  }
  try {
    const result = audioJobs.enqueue(ids, { force: Boolean(body.force) });
    res.json({ ...result, total: ids.length });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

projectRouter.get('/audio/exports', (req, res) => {
  res.json(req.project.audioExports.list());
});

projectRouter.post('/audio/exports', (req, res) => {
  try {
    const job = req.project.audioExports.start(req.body || {});
    res.json({ job });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message, missing: error.missing || undefined });
  }
});

projectRouter.post('/audio/exports/:id/cancel', (req, res) => {
  try {
    const job = req.project.audioExports.cancel(req.params.id);
    res.json({ job });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

projectRouter.get('/exports', (req, res) => {
  res.json(req.project.exports.list());
});

projectRouter.post('/exports', (req, res) => {
  try {
    const job = req.project.exports.start(req.body || {});
    res.json({ job });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message, missing: error.missing || undefined });
  }
});

projectRouter.get('/exports/:id', (req, res) => {
  const job = req.project.exports.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: '合成任务不存在' });
    return;
  }
  res.json({ job });
});

projectRouter.post('/exports/:id/cancel', (req, res) => {
  try {
    const job = req.project.exports.cancel(req.params.id);
    res.json({ job });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

app.use('/api/projects/:projectId', projectRouter);

const projectsRoot = path.join(config.dataDir, 'projects');
const assetStatic = express.static(projectsRoot, { maxAge: '30d', immutable: true });
const exportStatic = express.static(projectsRoot, { maxAge: '1h' });

// URL 是 /assets/<projectId>/<nodeId>/<file>，磁盘上是 projects/<projectId>/assets/...
// 只接管项目 ID，构建产物 /assets/index-*.js 要继续落到 dist 静态目录
app.use('/assets/:projectId', (req, res, next) => {
  if (!ID_PATTERN.test(req.params.projectId)) {
    next();
    return;
  }
  req.url = `/${req.params.projectId}/assets${req.url}`;
  assetStatic(req, res, next);
});

app.use('/exports/:projectId', (req, res, next) => {
  if (!ID_PATTERN.test(req.params.projectId)) {
    next();
    return;
  }
  req.url = `/${req.params.projectId}/exports${req.url}`;
  exportStatic(req, res, next);
});

if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/assets/') ||
      req.path.startsWith('/exports/')
    ) {
      next();
      return;
    }
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
}

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

app.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: '文件太大，请压缩后重试（图片 32 MB / 视频 256 MB）' });
    return;
  }
  console.error('[server]', error);
  if (res.headersSent) {
    next(error);
    return;
  }
  res.status(500).json({ error: error.message || '服务器错误' });
});

const server = app.listen(config.port, config.host, () => {
  const provider = currentProvider();
  console.log(`[storyboard-workbench] http://${config.host}:${config.port}`);
  console.log(`[storyboard-workbench] provider=${provider.name} model=${provider.model} size=${config.openai.size}`);
  console.log(`[storyboard-workbench] data=${config.dataDir}`);
  if (provider.name === 'aiclone' && !config.aiclone.apiKey) {
    console.warn('[storyboard-workbench] 未配置 AICLONE_API_KEY，请在页面「系统设置」中填写后再生成');
  }
  if (provider.name === 'mock') {
    console.log('[storyboard-workbench] 已显式启用本地占位图（IMAGE_PROVIDER=mock），仅用于测试');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${config.port} 已被占用，改 .env 里的 PORT 或释放端口`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

process.on('exit', () => projects.flushAll());
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
