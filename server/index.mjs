import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { Store } from './store.mjs';
import { parseCsv } from './csv.mjs';
import { buildProject } from './import.mjs';
import { createProvider } from './providers/index.mjs';
import { createJobs } from './jobs.mjs';
import { hashPrompt } from './hash.mjs';

const store = new Store(config.dataDir);
const provider = createProvider(config);

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

const jobs = createJobs({ store, provider, config, broadcast });

function publicConfig() {
  return {
    provider: provider.name,
    model: provider.model,
    size: config.openai.size,
    promptLang: config.promptLang,
    appendNegative: config.appendNegative,
    dailyCap: config.dailyCap,
    usage: store.usageCount(),
    concurrency: config.concurrency,
    hasKey: provider.name === 'mock' ? true : Boolean(config.openai.apiKey || Object.keys(config.openai.extraHeaders).length),
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
  res.json({ ok: true, provider: provider.name, model: provider.model, nodes: store.data.nodes.length });
});

app.get('/api/project', (req, res) => {
  res.json(projectPayload());
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

  const result = jobs.enqueue(ids, body);
  res.json({ ...result, total: ids.length });
});

app.use('/assets', express.static(store.assetsDir, { maxAge: '30d', immutable: true }));

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
  console.log(`[storyboard-workbench] http://${config.host}:${config.port}`);
  console.log(`[storyboard-workbench] provider=${provider.name} model=${provider.model} size=${config.openai.size}`);
  console.log(`[storyboard-workbench] data=${config.dataDir}`);
  if (provider.name === 'openai' && !publicConfig().hasKey) {
    console.warn('[storyboard-workbench] 警告：未检测到 OPENAI_API_KEY，生图请求会失败');
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
