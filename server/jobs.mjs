import path from 'node:path';
import { pruneAssets, saveAsset } from './assets.mjs';
import { buildPrompt } from './prompt.mjs';
import { createNodeJobQueue } from './job-queue.mjs';
import { clampInt } from './utils/num.mjs';

const RETRY_DELAY_MS = 1200;
const FATAL =
  /未配置|未找到|401|402|403|unauthorized|invalid.{0,20}key|提示词为空|上限|已删除|不存在/i;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 节点目录里除了候选图，还可能有镜头视频和它的海报
function keptFiles(node) {
  const keep = (node.data.run?.candidates || []).map((candidate) => candidate.filename);
  const video = node.data.video;
  if (video?.filename) keep.push(video.filename);
  if (video?.posterUrl) keep.push(path.basename(video.posterUrl.split('?')[0]));
  return keep;
}

export function createJobs({
  store,
  getProvider,
  config,
  broadcast,
  projectId,
  assetBase = '/assets',
  usage,
}) {
  function emit(node) {
    if (queue.isClosed()) return;
    broadcast({
      type: 'run',
      projectId,
      nodeId: node.id,
      run: node.data.run,
      usage: usage.count(),
    });
  }

  const queue = createNodeJobQueue({
    store,
    limit: () => config.concurrency,
    emit,
    execute: runExecute,
    logTag: '[job]',
  });

  function signatureFor(node, n, provider) {
    return `${node.data.promptHash}|${provider.name}:${provider.model}|${config.openai.size}|${config.promptLang}|${n}`;
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
    if (queue.isClosed()) return { queued: 0, skipped: nodeIds.length };
    const n = clampInt(options.n, 1, 8, 1);
    const force = Boolean(options.force);
    const seed =
      Number.isFinite(Number(options.seed)) && options.seed !== null && options.seed !== ''
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
      if (queue.busy(id) || node.data.run.status === 'running') {
        skipped += 1;
        continue;
      }
      if (!force && isSatisfied(node, n, provider)) {
        skipped += 1;
        continue;
      }

      queue.markQueued(node, n, { n, force, seed });
      queuedCount += 1;
    }

    store.save();
    queue.pump();
    return { queued: queuedCount, skipped };
  }

  async function generateOnce(provider, job, payload) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (job.cancelled) return { result: null, error: null };
      try {
        return {
          result: await provider.generate({ ...payload, signal: job.controller.signal }),
          error: null,
        };
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error);
        if (attempt > 0 || FATAL.test(message) || job.controller.signal.aborted) break;
        await delay(RETRY_DELAY_MS);
      }
    }
    return { result: null, error: lastError };
  }

  async function runExecute(job) {
    if (queue.isClosed()) throw new Error('项目已删除');
    const node = store.node(job.nodeId);
    if (!node) return;
    const data = node.data;
    const run = data.run;
    const provider = getProvider();

    if (run.promptHash !== data.promptHash) {
      run.candidates = [];
      run.selectedId = null;
      pruneAssets(store.assetsDir, node.id, keptFiles(node));
    }
    run.promptHash = data.promptHash;
    run.signature = signatureFor(node, job.n, provider);
    queue.settle(node, { status: 'running', progress: { done: 0, total: job.n } });

    const prompt = buildPrompt(data, config);
    if (!prompt.trim()) throw new Error('提示词为空，无法生成');

    let produced = 0;
    const failures = [];
    let capMessage = null;

    for (let i = 0; i < job.n; i += 1) {
      if (queue.isClosed()) throw new Error('项目已删除');
      if (job.cancelled) break;
      if (usage.count() >= config.dailyCap) {
        capMessage = `今日生成上限（${config.dailyCap} 张）已用完，可在系统设置里重置今日用量，或明天再跑`;
        break;
      }

      const seed = job.seed !== undefined ? job.seed + i : undefined;
      const { result, error } = await generateOnce(provider, job, {
        prompt,
        size: config.imageSize || config.openai.size,
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
      if (job.cancelled) break;
      if (!result?.data?.length) {
        failures.push(error || new Error('供应商没有返回图片数据'));
        continue;
      }
      if (queue.isClosed()) throw new Error('项目已删除');

      const asset = saveAsset(store.assetsDir, node.id, result, assetBase);
      const candidate = {
        id: asset.id,
        url: asset.url,
        filename: asset.filename,
        seed: seed ?? null,
        size: result.size || config.imageSize || config.openai.size,
        provider: provider.name,
        model: provider.model,
        promptHash: data.promptHash,
        createdAt: new Date().toISOString(),
      };

      run.candidates.push(candidate);
      run.selectedId = candidate.id;
      produced += 1;
      run.progress = { done: produced, total: job.n };
      run.updatedAt = new Date().toISOString();
      usage.bump();
      saveNodeRun(node.id, run);
      emit(node);
    }

    if (job.cancelled) {
      queue.settle(node, { status: run.candidates.length ? 'done' : 'idle' });
      return;
    }
    if (capMessage) {
      queue.settle(node, { status: 'error', error: capMessage });
      return;
    }
    if (failures.length) {
      const detail = failures[failures.length - 1]?.message || '未知错误';
      queue.settle(node, {
        status: 'error',
        error: `已生成 ${produced}/${job.n} 张，${failures.length} 张失败：${detail}`,
      });
      return;
    }

    queue.settle(node, { status: 'done', progress: { done: job.n, total: job.n } });
  }

  // 生成过程中按张落盘，这里只需要把最新的 run 同步回内存节点
  function saveNodeRun(nodeId, run) {
    const current = store.node(nodeId);
    if (!current) return;
    current.data.run = run;
    store.save();
  }

  return {
    enqueue,
    refresh: queue.pump,
    cancel: queue.cancel,
    cancelAll: queue.cancelAll,
    close: queue.close,
  };
}
