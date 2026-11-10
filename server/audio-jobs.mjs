import { pruneAssets, saveAsset } from './assets.mjs';
import { audioPeaks, probeAudio } from './video.mjs';
import { emptyAudioRun } from './audio.mjs';
import { roundTo } from './utils/num.mjs';
import { messageOf } from './utils/message.mjs';

export function createAudioJobs({
  store,
  config,
  broadcast,
  projectId,
  assetBase = '/assets',
  getProvider,
  getVoice,
}) {
  const queue = [];
  const queued = new Set();
  const running = new Map();
  let active = 0;
  let closed = false;

  function signatureFor(node, voice) {
    return `${node.data.textHash}|indextts|${voice.updatedAt || ''}|${config.audio.baseUrl}`;
  }

  function emit(node) {
    if (closed) return;
    broadcast({ type: 'audio-run', projectId, nodeId: node.id, run: node.data.run });
  }

  function isSatisfied(node, voice) {
    const run = node.data.run;
    return (
      run.status === 'done' &&
      run.textHash === node.data.textHash &&
      run.signature === signatureFor(node, voice) &&
      run.candidates.length > 0
    );
  }

  function enqueue(nodeIds, options = {}) {
    if (closed) return { queued: 0, skipped: nodeIds.length };
    const voice = getVoice();
    if (!voice.exists) {
      const error = new Error('未配置参考音频，请先在「系统设置 → 音频」里上传');
      error.status = 400;
      throw error;
    }
    const force = Boolean(options.force);
    const provider = getProvider();
    let queuedCount = 0;
    let skipped = 0;

    for (const id of nodeIds) {
      const node = store.node(id);
      if (!node || node.type !== 'audio') {
        skipped += 1;
        continue;
      }
      if (!String(node.data.text || '').trim()) {
        skipped += 1;
        continue;
      }
      if (running.has(id) || queued.has(id) || node.data.run.status === 'running') {
        skipped += 1;
        continue;
      }
      if (!force && isSatisfied(node, voice)) {
        skipped += 1;
        continue;
      }
      const run = node.data.run;
      run.status = 'queued';
      run.error = null;
      run.progress = { done: 0, total: 1 };
      run.updatedAt = new Date().toISOString();
      queued.add(id);
      queue.push({ nodeId: id, force, provider, cancelled: false, controller: new AbortController() });
      queuedCount += 1;
      emit(node);
    }

    store.save();
    pump();
    return { queued: queuedCount, skipped };
  }

  function pump() {
    if (closed) return;
    while (active < config.audio.concurrency && queue.length) {
      const job = queue.shift();
      queued.delete(job.nodeId);
      running.set(job.nodeId, job);
      active += 1;
      execute(job)
        .catch((error) => {
          if (closed) return;
          const node = store.node(job.nodeId);
          if (!node) return;
          if (job.cancelled) {
            node.data.run.status = node.data.run.candidates.length ? 'done' : 'idle';
            node.data.run.error = null;
            node.data.run.progress = null;
            node.data.run.updatedAt = new Date().toISOString();
            store.save();
            emit(node);
            return;
          }
          node.data.run.status = 'error';
          node.data.run.error = messageOf(error);
          node.data.run.progress = null;
          node.data.run.updatedAt = new Date().toISOString();
          store.save();
          emit(node);
          console.error(`[audio] ${job.nodeId} 失败:`, error?.message || error);
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
    const voice = getVoice();
    if (!voice.exists) throw new Error('参考音频已被移除，请重新上传');

    const text = String(data.text || '').trim();
    if (!text) throw new Error('文本为空，无法生成');

    if (run.textHash !== data.textHash) {
      run.candidates = [];
      run.selectedId = null;
      pruneAssets(store.assetsDir, node.id, []);
    }
    run.textHash = data.textHash;
    run.signature = signatureFor(node, voice);
    run.status = 'running';
    run.error = null;
    run.progress = { done: 0, total: 1 };
    run.updatedAt = new Date().toISOString();
    store.save();
    emit(node);

    const result = await job.provider.generate({
      text,
      voice,
      nodeId: node.id,
      signal: job.controller.signal,
    });
    if (!result?.data?.length) throw new Error('语音接口没有返回音频数据');
    if (closed) throw new Error('项目已删除');

    const asset = saveAsset(store.assetsDir, node.id, result, assetBase);
    const filePath = `${store.assetsDir}/${node.id}/${asset.filename}`;
    let durationSec = 0;
    try {
      const meta = await probeAudio(config.ffprobePath, filePath);
      durationSec = roundTo(meta.durationSec, 3);
    } catch (error) {
      throw new Error(`生成的音频无法读取：${error.message}`);
    }
    const peaks = await audioPeaks(config.ffmpegPath, filePath).catch(() => []);

    const candidate = {
      id: asset.id,
      url: asset.url,
      filename: asset.filename,
      durationSec,
      peaks,
      mime: result.mime || 'audio/wav',
      provider: 'indextts',
      model: 'IndexTTS',
      textHash: data.textHash,
      voiceUpdatedAt: voice.updatedAt,
      createdAt: new Date().toISOString(),
    };

    run.candidates.push(candidate);
    run.selectedId = candidate.id;
    run.status = 'done';
    run.progress = { done: 1, total: 1 };
    run.updatedAt = new Date().toISOString();
    store.save();
    emit(node);
  }

  function clear(nodeId) {
    const node = store.node(nodeId);
    if (!node || node.type !== 'audio') return null;
    node.data.run = emptyAudioRun();
    node.data.run.textHash = node.data.textHash;
    pruneAssets(store.assetsDir, node.id, []);
    store.save();
    emit(node);
    return node;
  }

  function cancel(nodeId) {
    const id = String(nodeId || '');
    const job = running.get(id);
    if (job) {
      if (!job.cancelled) {
        job.cancelled = true;
        job.controller.abort();
      }
      return 'running';
    }
    if (queued.has(id)) {
      queued.delete(id);
      const index = queue.findIndex((item) => item.nodeId === id);
      if (index >= 0) queue.splice(index, 1);
      const node = store.node(id);
      if (node) {
        node.data.run.status = node.data.run.candidates.length ? 'done' : 'idle';
        node.data.run.error = null;
        node.data.run.progress = null;
        node.data.run.updatedAt = new Date().toISOString();
        store.save();
        emit(node);
      }
      return 'queued';
    }
    return 'none';
  }

  function cancelAll() {
    let cleared = 0;
    for (const id of queued) {
      const node = store.node(id);
      if (!node) continue;
      node.data.run.status = node.data.run.candidates.length ? 'done' : 'idle';
      node.data.run.error = null;
      node.data.run.progress = null;
      node.data.run.updatedAt = new Date().toISOString();
      store.save();
      emit(node);
      cleared += 1;
    }
    queued.clear();
    queue.length = 0;

    let aborted = 0;
    for (const job of running.values()) {
      if (job.cancelled) continue;
      job.cancelled = true;
      job.controller.abort();
      aborted += 1;
    }
    return { queued: cleared, running: aborted };
  }

  function close() {
    closed = true;
    queue.length = 0;
    queued.clear();
    for (const job of running.values()) {
      job.cancelled = true;
      job.controller.abort();
    }
  }

  return { enqueue, clear, cancel, cancelAll, close };
}
