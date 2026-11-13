import { messageOf } from './utils/message.mjs';

// jobs 与 audio-jobs 共用的逐节点生成队列：
// 状态机（queue/queued/running/active/closed）、并发泵、取消与关闭完全一致，
// 差异只在 emit 载荷、入队校验和 execute 本体，由调用方注入
export function createNodeJobQueue({ store, limit, emit, execute, logTag }) {
  const queue = [];
  const queued = new Set();
  const running = new Map();
  let active = 0;
  let closed = false;

  function settle(node, { status, error = null, progress = null }) {
    node.data.run.status = status;
    node.data.run.error = error;
    node.data.run.progress = progress;
    node.data.run.updatedAt = new Date().toISOString();
    store.save();
    emit(node);
  }

  function restore(node) {
    settle(node, { status: node.data.run.candidates.length ? 'done' : 'idle' });
  }

  function pump() {
    if (closed) return;
    while (active < limit() && queue.length) {
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
            restore(node);
            return;
          }
          settle(node, { status: 'error', error: messageOf(error) });
          console.error(`${logTag} ${job.nodeId} 失败:`, error?.message || error);
        })
        .finally(() => {
          running.delete(job.nodeId);
          active -= 1;
          pump();
        });
    }
  }

  function markQueued(node, total, payload = {}) {
    const run = node.data.run;
    run.status = 'queued';
    run.error = null;
    run.progress = { done: 0, total };
    run.updatedAt = new Date().toISOString();
    queued.add(node.id);
    queue.push({
      nodeId: node.id,
      cancelled: false,
      controller: new AbortController(),
      ...payload,
    });
    emit(node);
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
      if (node) restore(node);
      return 'queued';
    }
    return 'none';
  }

  function cancelAll() {
    let cleared = 0;
    for (const id of queued) {
      const node = store.node(id);
      if (!node) continue;
      restore(node);
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

  function busy(id) {
    return running.has(id) || queued.has(id);
  }

  return {
    settle,
    restore,
    pump,
    markQueued,
    busy,
    cancel,
    cancelAll,
    close,
    isClosed: () => closed,
  };
}
