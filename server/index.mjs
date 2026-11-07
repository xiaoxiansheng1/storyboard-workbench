import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { Store } from './store.mjs';
import { parseCsv } from './csv.mjs';
import { buildProject } from './import.mjs';
import { createProvider } from './providers/index.mjs';
import { AICLONE_MODELS } from './providers/aiclone.mjs';
import { Settings, SETTING_LIMITS } from './settings.mjs';
import { createJobs } from './jobs.mjs';
import { createExports } from './exports.mjs';
import { hashPrompt } from './hash.mjs';
import { saveAsset } from './assets.mjs';

const store = new Store(config.dataDir);
const settings = new Settings(config.dataDir);
if (settings.data.apiKey) config.aiclone.apiKey = settings.data.apiKey;
if (settings.data.promptLang === 'zh' || settings.data.promptLang === 'en') {
  config.promptLang = settings.data.promptLang;
}
for (const key of Object.keys(SETTING_LIMITS)) {
  if (Number.isInteger(settings.data[key])) config[key] = settings.data[key];
}

const PROVIDER_LABELS = { mock: '本地占位', aiclone: 'AIClone', openai: 'OpenAI 兼容' };
const LIMIT_LABELS = { concurrency: '并发数', dailyCap: '每日生成上限', maxBatch: '单次批量上限' };
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

const jobs = createJobs({ store, getProvider: currentProvider, config, broadcast });
const videoExports = createExports({ store, config, broadcast });

const MISSING_KEY_ERROR = /未配置\s*AICLONE_API_KEY/;
const CREDENTIAL_ERROR = /未配置\s*AICLONE_API_KEY|HTTP\s*(401|402|403)|unauthorized|invalid.{0,20}key/i;

function clearCredentialErrors(matcher) {
  if (!providerHasKey(currentProvider())) return 0;
  let changed = 0;
  for (const node of store.data.nodes) {
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
    broadcast({ type: 'run', nodeId: node.id, run: node.data.run });
    changed += 1;
  }
  if (changed) store.save();
  return changed;
}

// 之前因缺少 Key 失败的镜头，在 Key 就绪后不应继续显示旧报错
clearCredentialErrors(MISSING_KEY_ERROR);

function publicConfig() {
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
    usage: store.usageCount(),
    concurrency: config.concurrency,
    maxBatch: config.maxBatch,
    hasKey: providerHasKey(provider),
    keyHint: maskKey(config.aiclone.apiKey),
  };
}

function settingsPayload() {
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
    usage: store.usageCount(),
    concurrency: config.concurrency,
    maxBatch: config.maxBatch,
  };
}

function projectPayload() {
  return {
    meta: store.data.meta,
    nodes: store.data.nodes,
    edges: store.data.edges,
    config: publicConfig(),
  };
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64mb' }));

app.get('/api/health', (req, res) => {
  const provider = currentProvider();
  res.json({ ok: true, provider: provider.name, model: provider.model, nodes: store.data.nodes.length });
});

app.get('/api/project', (req, res) => {
  res.json(projectPayload());
});

app.get('/api/settings', (req, res) => {
  res.json(settingsPayload());
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
  for (const key of Object.keys(SETTING_LIMITS)) {
    if (patch[key] !== undefined) config[key] = patch[key];
  }
  const provider = currentProvider();
  if (patch.imageModel && provider.name === 'aiclone') provider.model = patch.imageModel;
  clearCredentialErrors(patch.apiKey ? CREDENTIAL_ERROR : MISSING_KEY_ERROR);
  if (patch.concurrency !== undefined) jobs.refresh();

  broadcast({ type: 'settings', config: publicConfig() });
  res.json({ settings: settingsPayload(), config: publicConfig() });
});

app.post('/api/usage/reset', (req, res) => {
  res.json({ usage: store.resetUsage() });
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

app.post('/api/import', (req, res) => {
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

    store.replaceProject({ nodes: built.nodes, edges: built.edges, meta: built.meta });
    res.json({
      project: projectPayload(),
      stats: { ...built.stats, reused },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/nodes/:id', (req, res) => {
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
    return;
  }

  const body = req.body || {};
  if (body.position && Number.isFinite(Number(body.position.x)) && Number.isFinite(Number(body.position.y))) {
    node.position = { x: Number(body.position.x), y: Number(body.position.y) };
  }

  const fields = ['caption', 'promptZh', 'promptEn', 'negativeZh', 'negativeEn', 'videoPrompt'];
  let promptsChanged = false;
  for (const field of fields) {
    if (typeof body[field] === 'string' && body[field] !== node.data[field]) {
      node.data[field] = body[field];
      if (field.startsWith('prompt') || field.startsWith('negative')) promptsChanged = true;
    }
  }
  if (promptsChanged) node.data.promptHash = hashPrompt(node.data);

  store.save();
  res.json({ node });
});

app.post('/api/nodes/:id/generate', (req, res) => {
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
    return;
  }
  const result = jobs.enqueue([node.id], req.body || {});
  res.json({ ...result, node });
});

app.post('/api/nodes/:id/select', (req, res) => {
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
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

const UPLOAD_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);
const UPLOAD_MAX_BYTES = 32 * 1024 * 1024;

app.post('/api/nodes/:id/upload', (req, res) => {
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
    return;
  }

  const matched = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i.exec(
    String(req.body?.dataUrl || ''),
  );
  if (!matched) {
    res.status(400).json({ error: '请选择 PNG / JPG / WebP / GIF / AVIF 图片' });
    return;
  }
  const mime = matched[1].toLowerCase();
  if (!UPLOAD_MIMES.has(mime)) {
    res.status(400).json({ error: '不支持的图片格式' });
    return;
  }
  const buffer = Buffer.from(matched[2], 'base64');
  if (!buffer.length) {
    res.status(400).json({ error: '图片内容为空' });
    return;
  }
  if (buffer.length > UPLOAD_MAX_BYTES) {
    res.status(413).json({ error: '图片不能超过 32 MB' });
    return;
  }

  const asset = saveAsset(store.assetsDir, node.id, { data: buffer, mime });
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
  broadcast({ type: 'run', nodeId: node.id, run });
  res.json({ node, candidate });
});

app.delete('/api/nodes/:id/run', (req, res) => {
  const node = store.node(req.params.id);
  if (!node) {
    res.status(404).json({ error: '节点不存在' });
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
  broadcast({ type: 'run', nodeId: node.id, run: node.data.run });
  res.json({ node });
});

app.post('/api/generate/batch', (req, res) => {
  const body = req.body || {};
  const scope = body.scope === 'all' ? 'all' : 'missing';
  const nodes = store.data.nodes;
  const ids = Array.isArray(body.nodeIds) && body.nodeIds.length
    ? body.nodeIds
    : nodes
        .filter((node) => {
          if (scope === 'all') return true;
          const run = node.data.run;
          const stale = run.promptHash !== node.data.promptHash;
          return stale || run.status === 'error' || run.candidates.length === 0;
        })
        .map((node) => node.id);

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

app.get('/api/exports', (req, res) => {
  res.json(videoExports.list());
});

app.post('/api/exports', (req, res) => {
  try {
    const job = videoExports.start(req.body || {});
    res.json({ job });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message, missing: error.missing || undefined });
  }
});

app.get('/api/exports/:id', (req, res) => {
  const job = videoExports.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: '合成任务不存在' });
    return;
  }
  res.json({ job });
});

app.post('/api/exports/:id/cancel', (req, res) => {
  try {
    const job = videoExports.cancel(req.params.id);
    res.json({ job });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

app.use('/assets', express.static(store.assetsDir, { maxAge: '30d', immutable: true }));
app.use('/exports', express.static(config.exportDir, { maxAge: '1h' }));

if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/assets/')) {
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

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
