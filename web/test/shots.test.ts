import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { StateCreator } from 'zustand';
import type { Node } from '@xyflow/react';
import type { AudioData, Project, ShotData, WorkbenchNodeData } from '../src/types';
import { createShotsSlice, type ShotsSlice } from '../src/store/shots';
import { audioNode, makeProject, makeRun, shotNode } from './fixtures';

vi.mock('../src/api', () => ({
  api: vi.fn(async () => ({})),
  apiUpload: vi.fn(async () => ({})),
}));

interface ShotsStore extends ShotsSlice {
  nodes: Node<WorkbenchNodeData>[];
  project: Project | null;
  projectId: string | null;
}

function makeStore(nodes: Node<WorkbenchNodeData>[], project: Project | null = null) {
  const store = createStore<ShotsStore>()(
    createShotsSlice as unknown as StateCreator<ShotsStore, [], [], ShotsStore>,
  );
  store.setState({ nodes, project, projectId: 'p1' });
  return store;
}

describe('applyRun', () => {
  it('把 run 合并进匹配的 shot 节点，不影响其他节点', () => {
    const run = makeRun({ status: 'running', progress: { done: 1, total: 2 } });
    const store = makeStore([shotNode('s1', 1), shotNode('s2', 2, 100, 0), audioNode('a1', 1)]);

    store.getState().applyRun('s1', run);

    const [s1, s2, a1] = store.getState().nodes;
    expect((s1.data as ShotData).run).toEqual(run);
    expect(s1.position).toEqual({ x: 0, y: 0 });
    expect((s2.data as ShotData).run.status).toBe('idle');
    expect((a1.data as AudioData).run.status).toBe('idle');
  });

  it('usage 提供时同步到 project.config.usage', () => {
    const store = makeStore([shotNode('s1', 1)], makeProject(5));

    store.getState().applyRun('s1', makeRun(), 6);

    expect(store.getState().project?.config.usage).toBe(6);
  });

  it('不传 usage 时 project 引用不变', () => {
    const project = makeProject(5);
    const store = makeStore([shotNode('s1', 1)], project);

    store.getState().applyRun('s1', makeRun());

    expect(store.getState().project).toBe(project);
  });

  it('节点不存在时 nodes 数据不变', () => {
    const store = makeStore([shotNode('s1', 1)]);
    const before = store.getState().nodes;

    store.getState().applyRun('missing', makeRun({ status: 'done' }));

    const after = store.getState().nodes;
    expect((after[0].data as ShotData).run.status).toBe('idle');
    expect(after[0].data).toBe(before[0].data);
  });
});
