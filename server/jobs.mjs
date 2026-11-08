import { saveAsset } from './assets.mjs';
import { buildPrompt } from './prompt.mjs';

const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

export function createJobs({ store, getProvider, config, broadcast, projectId, assetBase = '/assets' }) {
  const queue = [];
  const queued = new Set();
  const running = new Set();
  let active = 0;
  let closed = false;

  function signatureFor(node, n, provider) {
    return `${node.data.promptHash}|${provider.name}:${provider.model}|${config.openai.size}|${config.promptLang}|${n}`;
  }

  function emit(node) {
    if (closed) return;
    broadcast({ type: 'run', projectId, nodeId: node.id, run: node.data.run, usage: store.usageCount() });
  }

  function isSatisfied(node, n, provider) {
    const run = node.data.run;
    const selected = run.candidates.find((candidate) => candidate.id === run.selectedId);
    if (
      run.status === 'done' &&
      run.promptHash === node.data.promptHash &&
      selected?.provider === 'upload'
    ) {
      return true;
    }
    return (
      run.status === 'done' &&
      run.promptHash === node.data.promptHash &&
      run.signature === signatureFor(node, n, provider) &&
      run.candidates.length >= n
    );
  }

  function enqueue(nodeIds, options = {}) {
    if (closed) return { queued: 0, skipped: nodeIds.length };
    const n = clampInt(options.n, 1, 8, 1);
    const force = Boolean(options.force);
    const seed = Number.isFinite(Number(options.seed)) && options.seed !== null && options.seed !== ''
      ? Math.trunc(Number(options.seed))
      : undefined;

    let queuedCount = 0;
    let skipped = 0;
    const provider = getProvider();

    for (const id of nodeIds) {
      const node = store.node(id);
      if (!node || node.type !== 'shot') {
        skipped += 1;
        continue;
      }
      if (running.has(id) || queued.has(id) || node.data.run.status === 'running') {
        skipped += 1;
        continue;
      }
      if (!force && isSatisfied(node, n, provider)) {
        skipped += 1;
        continue;
      }

      const run = node.data.run;
      run.status = 'queued';
      run.error = null;
      run.progress = { done: 0, total: n };
      run.updatedAt = new Date().toISOString();
      queued.add(id);
      queue.push({ nodeId: id, n, force, seed });
      queuedCount += 1;
      emit(node);
    }

    store.save();
    pump();
    return { queued: queuedCount, skipped };
  }

  function pump() {
    if (closed) return;
    while (active < config.concurrency && queue.length) {
      const job = queue.shift();
      queued.delete(job.nodeId);
      running.add(job.nodeId);
      active += 1;
      execute(job)
        .catch((error) => {
          if (closed) return;
          const node = store.node(job.nodeId);
          if (!node) return;
          node.data.run.status = 'error';
          node.data.run.error = error?.message || String(error);
          node.data.run.progress = null;
          node.data.run.updatedAt = new Date().toISOString();
          store.save();
          emit(node);
          console.error(`[job] ${job.nodeId} 失败:`, error?.message || error);
        })
        .finally(() => {
          running.delete(job.nodeId);
          active -= 1;
          pump();
        });
    }
  }

  async function execute(job) {
    if (closed) throw new Error('项目已删除');
    const node = store.node(job.nodeId);
    if (!node) return;
    const data = node.data;
    const run = data.run;
    const provider = getProvider();

    if (run.promptHash !== data.promptHash) {
      run.candidates = [];
      run.selectedId = null;
    }
    run.promptHash = data.promptHash;
    run.signature = signatureFor(node, job.n, provider);
    run.status = 'running';
    run.error = null;
    run.progress = { done: 0, total: job.n };
    run.updatedAt = new Date().toISOString();
    store.save();
    emit(node);

    const prompt = buildPrompt(data, config);
    if (!prompt.trim()) throw new Error('提示词为空，无法生成');

    for (let i = 0; i < job.n; i += 1) {
      if (closed) throw new Error('项目已删除');
      if (store.usageCount() >= config.dailyCap) {
        throw new Error(`今日生成上限（${config.dailyCap} 张）已用完，请明天再跑或在系统设置里调高每日上限`);
      }

      const seed = job.seed !== undefined ? job.seed + i : undefined;
      const result = await provider.generate({
        prompt,
        size: config.openai.size,
        seed,
        meta: {
          no: data.no,
          shotId: node.id,
          srtStart: data.srtStart,
          duration: data.duration,
          anchor: data.anchor,
          caption: data.caption,
          prompt,
        },
      });

      if (!result?.data?.length) throw new Error('供应商没有返回图片数据');
      if (closed) throw new Error('项目已删除');

      const asset = saveAsset(store.assetsDir, node.id, result, assetBase);
      const candidate = {
        id: asset.id,
        url: asset.url,
        filename: asset.filename,
        seed: seed ?? null,
        size: result.size || config.openai.size,
        provider: provider.name,
        model: provider.model,
        promptHash: data.promptHash,
        createdAt: new Date().toISOString(),
      };

      run.candidates.push(candidate);
      run.selectedId = candidate.id;
      run.progress = { done: i + 1, total: job.n };
      run.updatedAt = new Date().toISOString();
      store.bumpUsage();
      saveNodeRun(node.id, run);
      emit(node);
    }

    run.status = 'done';
    run.progress = { done: job.n, total: job.n };
    run.updatedAt = new Date().toISOString();
    saveNodeRun(node.id, run);
    emit(node);
  }

  // store.bumpUsage 会写盘，这里只需要把最新的 run 同步回内存节点
  function saveNodeRun(nodeId, run) {
    const current = store.node(nodeId);
    if (!current) return;
    current.data.run = run;
    store.save();
  }

  function close() {
    closed = true;
    queue.length = 0;
    queued.clear();
  }

  return { enqueue, refresh: pump, close };
}
