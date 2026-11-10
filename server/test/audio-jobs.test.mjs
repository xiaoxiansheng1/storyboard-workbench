import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioJobs } from '../audio-jobs.mjs';

const VOICE = { exists: true, updatedAt: 'voice-1' };

function makeJobs({ voice = VOICE } = {}) {
  const node = {
    id: 'audio-01',
    type: 'audio',
    data: {
      text: '第一句。',
      textHash: 'hash-1',
      run: {
        status: 'done',
        candidates: [{ id: 'c1' }],
        selectedId: 'c1',
        error: null,
        textHash: 'hash-1',
        signature: `hash-1|indextts|${voice.updatedAt || ''}|http://tts`,
        progress: null,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  };
  const store = {
    node: (id) => (id === node.id ? node : null),
    save() {},
  };
  const jobs = createAudioJobs({
    store,
    config: { audio: { concurrency: 0, baseUrl: 'http://tts' } },
    broadcast() {},
    projectId: 'p1',
    getProvider: () => ({}),
    getVoice: () => voice,
  });
  return { node, jobs };
}

test('批量配音默认跳过已生成且签名一致的节点', () => {
  const { jobs } = makeJobs();
  assert.deepEqual(jobs.enqueue(['audio-01']), { queued: 0, skipped: 1 });
  jobs.close();
});

test('force 时批量配音会重新入队已生成的节点', () => {
  const { node, jobs } = makeJobs();
  assert.deepEqual(jobs.enqueue(['audio-01'], { force: true }), { queued: 1, skipped: 0 });
  assert.equal(node.data.run.status, 'queued');
  assert.deepEqual(node.data.run.progress, { done: 0, total: 1 });
  jobs.close();
});

test('没有参考音频时拒绝批量配音', () => {
  const { jobs } = makeJobs({ voice: { exists: false, updatedAt: null } });
  assert.throws(() => jobs.enqueue(['audio-01'], { force: true }), /未配置参考音频/);
  jobs.close();
});
