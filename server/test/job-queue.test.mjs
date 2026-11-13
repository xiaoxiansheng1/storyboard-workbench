import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeJobQueue } from '../job-queue.mjs';

function makeNode(id, candidates = []) {
  return {
    id,
    data: {
      run: {
        status: 'idle',
        candidates,
        selectedId: candidates[0]?.id ?? null,
        error: null,
        progress: null,
      },
    },
  };
}

function makeStore(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return { node: (id) => byId.get(id) || null, save() {} };
}

const waitFor = async (check, timeout = 2000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('等待超时');
};

test('队列按并发上限依次执行并落盘完成状态', async () => {
  const nodes = [makeNode('n1'), makeNode('n2')];
  const order = [];
  const queue = createNodeJobQueue({
    store: makeStore(nodes),
    limit: () => 1,
    emit() {},
    execute: async (job) => {
      order.push(job.nodeId);
      const node = nodes.find((item) => item.id === job.nodeId);
      node.data.run.candidates.push({ id: 'c1' });
      queue.settle(node, { status: 'done' });
    },
    logTag: '[test]',
  });
  for (const node of nodes) queue.markQueued(node, 1);
  queue.pump();
  await waitFor(() => order.length === 2);
  assert.deepEqual(order, ['n1', 'n2']);
  assert.equal(nodes[0].data.run.status, 'done');
  assert.equal(nodes[1].data.run.status, 'done');
  assert.deepEqual(nodes[1].data.run.progress, null);
});

test('并发上限 2 时两个任务同时执行', async () => {
  const nodes = [makeNode('n1'), makeNode('n2')];
  let running = 0;
  let peak = 0;
  const queue = createNodeJobQueue({
    store: makeStore(nodes),
    limit: () => 2,
    emit() {},
    execute: async (job) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const node = nodes.find((item) => item.id === job.nodeId);
      node.data.run.candidates.push({ id: 'c1' });
      queue.settle(node, { status: 'done' });
      running -= 1;
    },
    logTag: '[test]',
  });
  for (const node of nodes) queue.markQueued(node, 1);
  queue.pump();
  await waitFor(() => nodes.every((node) => node.data.run.status === 'done'));
  assert.equal(peak, 2);
});

test('执行失败时节点落盘错误信息', async () => {
  const nodes = [makeNode('n1')];
  const queue = createNodeJobQueue({
    store: makeStore(nodes),
    limit: () => 1,
    emit() {},
    execute: async () => {
      throw new Error('生成失败');
    },
    logTag: '[test]',
  });
  queue.markQueued(nodes[0], 1);
  queue.pump();
  await waitFor(() => nodes[0].data.run.status === 'error');
  assert.match(nodes[0].data.run.error, /生成失败/);
  assert.equal(nodes[0].data.run.progress, null);
});

test('取消运行中的任务会中止并恢复 done/idle', async () => {
  const nodes = [makeNode('n1', [{ id: 'c1' }]), makeNode('n2')];
  const queue = createNodeJobQueue({
    store: makeStore(nodes),
    limit: () => 1,
    emit() {},
    execute: (job) =>
      new Promise((resolve, reject) => {
        job.controller.signal.addEventListener('abort', () => reject(new Error('已取消')));
      }),
    logTag: '[test]',
  });
  for (const node of nodes) queue.markQueued(node, 1);
  queue.pump();
  assert.equal(queue.cancel('n2'), 'queued');
  assert.equal(nodes[1].data.run.status, 'idle');
  assert.equal(queue.cancel('n2'), 'none');
  assert.equal(queue.cancel('n1'), 'running');
  await waitFor(() => nodes[0].data.run.status === 'done');
});

test('cancelAll 清空队列并中止运行中的任务', async () => {
  const nodes = [makeNode('n1', [{ id: 'c1' }]), makeNode('n2')];
  const queue = createNodeJobQueue({
    store: makeStore(nodes),
    limit: () => 1,
    emit() {},
    execute: (job) =>
      new Promise((resolve, reject) => {
        job.controller.signal.addEventListener('abort', () => reject(new Error('已取消')));
      }),
    logTag: '[test]',
  });
  for (const node of nodes) queue.markQueued(node, 1);
  queue.pump();
  const result = queue.cancelAll();
  assert.deepEqual(result, { queued: 1, running: 1 });
  assert.equal(nodes[1].data.run.status, 'idle');
  await waitFor(() => nodes[0].data.run.status === 'done');
});

test('close 后不再执行新任务', async () => {
  const nodes = [makeNode('n1')];
  let executed = 0;
  const queue = createNodeJobQueue({
    store: makeStore(nodes),
    limit: () => 1,
    emit() {},
    execute: async () => {
      executed += 1;
    },
    logTag: '[test]',
  });
  queue.close();
  assert.equal(queue.isClosed(), true);
  queue.markQueued(nodes[0], 1);
  queue.pump();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(executed, 0);
});
