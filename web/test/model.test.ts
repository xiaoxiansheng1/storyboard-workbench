import { describe, expect, it } from 'vitest';
import type { AudioData, AudioNodeModel, ProjectNode } from '../src/types';
import { makeAudioData, makeShotData } from './fixtures';
import {
  patchAudioList,
  patchNodeList,
  projectBase,
  toFlowEdge,
  toFlowNode,
  withAudioData,
  withAudioNos,
  withPositions,
} from '../src/store/model';

function shotModel(id: string, no: number, x = 10, y = 20): ProjectNode {
  return { id, type: 'shot', position: { x, y }, data: makeShotData(no) };
}

function audioModel(id: string, no: number, x = 30, y = 40): AudioNodeModel {
  return { id, type: 'audio', position: { x, y }, data: makeAudioData(no) };
}

describe('toFlowNode', () => {
  it('保留 id/type/position/data 并按类型设置宽度', () => {
    const model = shotModel('s1', 1);
    const node = toFlowNode(model);
    expect(node.id).toBe('s1');
    expect(node.type).toBe('shot');
    expect(node.position).toEqual({ x: 10, y: 20 });
    expect(node.data).toBe(model.data);
    expect(node.style).toEqual({ width: 360 });

    const audio = toFlowNode(audioModel('a1', 1));
    expect(audio.style).toEqual({ width: 330 });
  });
});

describe('toFlowEdge', () => {
  it('音频边可选、shot 边不可选', () => {
    const audioEdge = toFlowEdge({ id: 'e1', source: 'a1', target: 's1', kind: 'audio' });
    expect(audioEdge.type).toBe('smoothstep');
    expect(audioEdge.selectable).toBe(true);
    expect(audioEdge.className).toBe('audio-edge');
    expect(audioEdge.data).toEqual({ kind: 'audio' });

    const shotEdge = toFlowEdge({ id: 'e2', source: 's1', target: 's2' });
    expect(shotEdge.selectable).toBe(false);
    expect(shotEdge.className).toBe('shot-edge');
    expect(shotEdge.data).toEqual({ kind: 'shot' });
  });
});

describe('patchNodeList', () => {
  it('只替换目标节点的 position 和 data，其余节点保持原引用', () => {
    const s1 = shotModel('s1', 1);
    const s2 = shotModel('s2', 2, 100, 0);
    const nodes = [toFlowNode(s1), toFlowNode(s2)];

    const out = patchNodeList(nodes, { ...s1, position: { x: 99, y: 88 } });

    expect(out[0].position).toEqual({ x: 99, y: 88 });
    expect(out[1]).toBe(nodes[1]);
  });

  it('目标不存在时原样返回', () => {
    const nodes = [toFlowNode(shotModel('s1', 1))];
    const out = patchNodeList(nodes, shotModel('missing', 9));
    expect(out.map((node) => node.id)).toEqual(['s1']);
  });
});

describe('patchAudioList', () => {
  it('替换音频节点 data', () => {
    const a1 = audioModel('a1', 1);
    const nodes = [toFlowNode(a1), toFlowNode(shotModel('s1', 1))];
    const out = patchAudioList(nodes, { ...a1, data: { ...a1.data, text: '新台词' } });
    expect((out[0].data as AudioData).text).toBe('新台词');
    expect(out[1]).toBe(nodes[1]);
  });
});

describe('withAudioData', () => {
  it('合并 patch 且不影响其他节点', () => {
    const nodes = [toFlowNode(audioModel('a1', 1)), toFlowNode(audioModel('a2', 2))];
    const out = withAudioData(nodes, 'a1', { text: '新台词' });
    const first = out[0].data as AudioData;
    expect(first.text).toBe('新台词');
    expect(first.no).toBe(1);
    expect(out[0].data).not.toBe(nodes[0].data);
    expect(out[1]).toBe(nodes[1]);
  });
});

describe('withAudioNos', () => {
  it('更新编号，带 position 时一并应用，无对应项的节点不动', () => {
    const nodes = [toFlowNode(audioModel('a1', 3)), toFlowNode(audioModel('a2', 4))];
    const out = withAudioNos(nodes, [
      { id: 'a1', position: { x: 9, y: 9 }, data: { no: 1 } },
      { id: 'a2', data: { no: 2 } },
    ]);
    expect(out[0].position).toEqual({ x: 9, y: 9 });
    expect((out[0].data as AudioData).no).toBe(1);
    expect(out[1].position).toEqual({ x: 30, y: 40 });
    expect((out[1].data as AudioData).no).toBe(2);
  });
});

describe('withPositions', () => {
  it('只应用映射里的坐标并克隆对象', () => {
    const nodes = [toFlowNode(shotModel('s1', 1)), toFlowNode(shotModel('s2', 2))];
    const source = { x: 50, y: 60 };
    const out = withPositions(nodes, { s1: source });
    expect(out[0].position).toEqual(source);
    expect(out[0].position).not.toBe(source);
    expect(out[1].position).toEqual({ x: 10, y: 20 });
  });
});

describe('projectBase', () => {
  it('有项目时返回项目前缀，否则返回 /api', () => {
    expect(projectBase({ projectId: 'p1' })).toBe('/api/projects/p1');
    expect(projectBase({ projectId: null })).toBe('/api');
  });
});
