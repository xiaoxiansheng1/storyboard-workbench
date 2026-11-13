import { pruneAssets, saveAsset } from './assets.mjs';
import { audioPeaks, probeAudio } from './video.mjs';
import { createNodeJobQueue } from './job-queue.mjs';
import { emptyAudioRun } from './audio.mjs';
import { roundTo } from './utils/num.mjs';

export function createAudioJobs({
  store,
  config,
  broadcast,
  projectId,
  assetBase = '/assets',
  getProvider,
  getVoice,
}) {
  function emit(node) {
    if (queue.isClosed()) return;
    broadcast({ type: 'audio-run', projectId, nodeId: node.id, run: node.data.run });
  }

  const queue = createNodeJobQueue({
    store,
    limit: () => config.audio.concurrency,
    emit,
    execute: runExecute,
    logTag: '[audio]',
  });

  function signatureFor(node, voice) {
    return `${node.data.textHash}|indextts|${voice.updatedAt || ''}|${config.audio.baseUrl}`;
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
    if (queue.isClosed()) return { queued: 0, skipped: nodeIds.length };
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
      if (queue.busy(id) || node.data.run.status === 'running') {
        skipped += 1;
        continue;
      }
      if (!force && isSatisfied(node, voice)) {
        skipped += 1;
        continue;
      }
      queue.markQueued(node, 1, { force, provider });
      queuedCount += 1;
    }

    store.save();
    queue.pump();
    return { queued: queuedCount, skipped };
  }

  async function runExecute(job) {
    if (queue.isClosed()) throw new Error('项目已删除');
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
    queue.settle(node, { status: 'running', progress: { done: 0, total: 1 } });

    const result = await job.provider.generate({
      text,
      voice,
      nodeId: node.id,
      signal: job.controller.signal,
    });
    if (!result?.data?.length) throw new Error('语音接口没有返回音频数据');
    if (queue.isClosed()) throw new Error('项目已删除');

    const asset = saveAsset(store.assetsDir, node.id, result, assetBase);
    const filePath = `${store.assetsDir}/${node.id}/${asset.filename}`;
    let durationSec;
    try {
      const meta = await probeAudio(config.ffprobePath, filePath);
      durationSec = roundTo(meta.durationSec, 3);
    } catch (error) {
      throw new Error(`生成的音频无法读取：${error.message}`, { cause: error });
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
    queue.settle(node, { status: 'done', progress: { done: 1, total: 1 } });
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

  return {
    enqueue,
    clear,
    cancel: queue.cancel,
    cancelAll: queue.cancelAll,
    close: queue.close,
  };
}
