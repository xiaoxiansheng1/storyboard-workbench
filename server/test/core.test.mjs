import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPrompt } from '../prompt.mjs';
import { hashPrompt } from '../hash.mjs';
import { splitAudioText, orderedAudioNodes, ensureAudioLinks } from '../audio.mjs';
import { toImageRatio } from '../providers/aiclone.mjs';
import { Usage } from '../usage.mjs';

const shot = {
  promptZh: '雨夜街头，路灯下的出租车',
  promptEn: 'A taxi under a street lamp on a rainy night',
  negativeZh: '模糊，多发肢体',
  negativeEn: 'blurry, extra limbs',
};

test('buildPrompt 按语言取提示词，缺失时回退另一种语言', () => {
  assert.equal(buildPrompt(shot, { promptLang: 'zh' }), shot.promptZh);
  assert.equal(buildPrompt(shot, { promptLang: 'en' }), shot.promptEn);
  assert.equal(buildPrompt({ ...shot, promptZh: '' }, { promptLang: 'zh' }), shot.promptEn);
  assert.equal(buildPrompt({ promptZh: '  仅中文  ' }, { promptLang: 'en' }), '仅中文');
});

test('buildPrompt 只在 appendNegative 打开时追加负面提示词', () => {
  assert.equal(
    buildPrompt(shot, { promptLang: 'zh', appendNegative: true }),
    `${shot.promptZh}\n\nAvoid: ${shot.negativeZh}`,
  );
  assert.equal(buildPrompt(shot, { promptLang: 'zh', appendNegative: false }), shot.promptZh);
  assert.equal(
    buildPrompt({ ...shot, negativeZh: '' }, { promptLang: 'zh', appendNegative: true }),
    shot.promptZh,
  );
});

test('hashPrompt 对字段变化敏感且长度固定', () => {
  const base = hashPrompt(shot);
  assert.match(base, /^[0-9a-f]{12}$/);
  assert.equal(hashPrompt({ ...shot }), base);
  assert.notEqual(hashPrompt({ ...shot, promptZh: '换个场景' }), base);
  assert.notEqual(hashPrompt({ ...shot, negativeEn: '' }), base);
});

test('toImageRatio 统一成接口接受的三种比例', () => {
  assert.equal(toImageRatio('1:1'), '1:1');
  assert.equal(toImageRatio('16:9'), '16:9');
  assert.equal(toImageRatio('1024x1024'), '1:1');
  assert.equal(toImageRatio('1536×1024'), '16:9');
  assert.equal(toImageRatio('720:1280'), '9:16');
  assert.equal(toImageRatio('1024x768'), '16:9');
  assert.equal(toImageRatio('随便写的'), '16:9');
  assert.equal(toImageRatio(''), '16:9');
});

test('splitAudioText 清洗字幕、按句子分块并限制单块长度', () => {
  assert.deepEqual(splitAudioText('   '), []);
  // 相邻短句会合并到同一块，直到接近 chunkChars
  assert.deepEqual(splitAudioText('第一句。第二句！'), ['第一句。第二句！']);

  const srt = ['1', '00:00:01,000 --> 00:00:03,000', '<i>开场白。</i>', '', '2', '00:00:03,000 --> 00:00:05,000', '第二句。'].join('\n');
  assert.deepEqual(splitAudioText(srt), ['开场白。第二句。']);

  const long = '这是一段很长的解说词，'.repeat(20);
  const chunks = splitAudioText(long, 40);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 80));
  assert.equal(chunks.join(''), long);
});

const audioNode = (id, no) => ({ id, type: 'audio', position: { x: no, y: 0 }, data: { no } });
const audioLink = (source, target) => ({
  id: `audio-edge-${source}-${target}`,
  source,
  target,
  kind: 'audio',
});

test('orderedAudioNodes 沿画布连线排序，未连接的节点按序号补在后面', () => {
  const nodes = [
    audioNode('a', 1),
    audioNode('b', 2),
    audioNode('c', 3),
    audioNode('d', 4),
    { id: 's1', type: 'shot', position: { x: 0, y: 0 }, data: { no: 1 } },
  ];
  const edges = [audioLink('c', 'a'), audioLink('a', 'b')];
  assert.deepEqual(
    orderedAudioNodes(nodes, edges).map((node) => node.id),
    ['c', 'a', 'b', 'd'],
  );
});

test('orderedAudioNodes 忽略分镜连线与重复出线，遇到环不死循环', () => {
  const nodes = [audioNode('a', 1), audioNode('b', 2), audioNode('c', 3)];
  const edges = [
    { id: 'shot', source: 'a', target: 's1' },
    audioLink('a', 'b'),
    audioLink('a', 'c'),
  ];
  assert.deepEqual(
    orderedAudioNodes(nodes, edges).map((node) => node.id),
    ['a', 'b', 'c'],
  );

  const loop = [audioLink('a', 'b'), audioLink('b', 'a')];
  assert.deepEqual(
    orderedAudioNodes(nodes.slice(0, 2), loop).map((node) => node.id),
    ['a', 'b'],
  );
});

test('ensureAudioLinks 给没有连线的老项目补一条序号链', () => {
  const store = {
    data: {
      nodes: [audioNode('a', 1), audioNode('b', 2), audioNode('c', 3)],
      edges: [{ id: 'shot', source: 's1', target: 's2' }],
    },
    saved: 0,
    save() {
      this.saved += 1;
    },
  };
  assert.equal(ensureAudioLinks(store), true);
  assert.deepEqual(
    store.data.edges
      .filter((edge) => edge.kind === 'audio')
      .map((edge) => [edge.source, edge.target, edge.kind]),
    [
      ['a', 'b', 'audio'],
      ['b', 'c', 'audio'],
    ],
  );
  assert.equal(ensureAudioLinks(store), false);
  assert.equal(store.saved, 1);
});

test('Usage 跨项目共享计数，可自增与重置', async () => {  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-usage-'));
  try {
    const usage = new Usage(dir);
    assert.equal(usage.count(), 0);
    usage.bump();
    usage.bump(2);
    assert.equal(usage.count(), 3);

    const other = new Usage(dir);
    assert.equal(other.count(), 0, '未落盘前读到的是内存里的旧值');

    assert.equal(usage.reset(), 0);
    assert.equal(usage.count(), 0);

    usage.bump();
    await new Promise((resolve) => setTimeout(resolve, 260));
    assert.equal(new Usage(dir).count(), 1, '落盘后新实例能读到最新计数');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
