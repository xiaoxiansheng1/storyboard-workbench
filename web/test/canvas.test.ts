import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { StateCreator } from 'zustand';
import type { XYPosition } from '@xyflow/react';
import { api } from '../src/api';
import { createCanvasSlice, type CanvasSlice } from '../src/store/canvas';
import { shotNode } from './fixtures';
import { HISTORY_LIMIT } from '../src/store/model';

vi.mock('../src/api', () => ({
  api: vi.fn(async () => ({})),
  apiUpload: vi.fn(async () => ({})),
}));

type CanvasStore = CanvasSlice & { projectId: string | null };

function makeStore() {
  const store = createStore<CanvasStore>()(
    createCanvasSlice as unknown as StateCreator<CanvasStore, [], [], CanvasStore>,
  );
  store.setState({ projectId: 'p1', nodes: [shotNode('n1', 1), shotNode('n2', 2, 100, 0)] });
  return store;
}

function moveNode(store: ReturnType<typeof makeStore>, id: string, to: XYPosition) {
  store.setState({
    nodes: store
      .getState()
      .nodes.map((node) => (node.id === id ? { ...node, position: { ...to } } : node)),
  });
}

function drag(store: ReturnType<typeof makeStore>, id: string, to: XYPosition) {
  store.getState().beginPositionDrag([id]);
  moveNode(store, id, to);
  store.getState().commitPositionDrag();
}

beforeEach(() => {
  vi.mocked(api).mockClear();
});

describe('commitPositionDrag', () => {
  it('记录 from/to，清空 redo 与 dragOrigin', () => {
    const store = makeStore();
    store.setState({ redo: [[{ id: 'n1', from: { x: 0, y: 0 }, to: { x: 9, y: 9 } }]] });

    drag(store, 'n1', { x: 50, y: 60 });

    expect(store.getState().undo).toEqual([
      [{ id: 'n1', from: { x: 0, y: 0 }, to: { x: 50, y: 60 } }],
    ]);
    expect(store.getState().redo).toEqual([]);
    expect(store.getState().dragOrigin).toEqual({});
  });

  it('位置没变时不进历史', () => {
    const store = makeStore();
    drag(store, 'n1', { x: 0, y: 0 });
    expect(store.getState().undo).toEqual([]);
    expect(store.getState().dragOrigin).toEqual({});
  });

  it('多个节点的移动合为一个 undo 步', () => {
    const store = makeStore();
    store.getState().beginPositionDrag(['n1', 'n2']);
    moveNode(store, 'n1', { x: 10, y: 0 });
    moveNode(store, 'n2', { x: 110, y: 0 });
    store.getState().commitPositionDrag();

    const step = store.getState().undo.at(-1);
    expect(step?.map((change) => change.id)).toEqual(['n1', 'n2']);
    expect(step?.[0]).toEqual({ id: 'n1', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } });
    expect(step?.[1]).toEqual({ id: 'n2', from: { x: 100, y: 0 }, to: { x: 110, y: 0 } });
  });
});

describe('undoPositions / redoPositions', () => {
  it('undo 恢复 from，redo 恢复 to', () => {
    const store = makeStore();
    drag(store, 'n1', { x: 50, y: 0 });

    store.getState().undoPositions();
    expect(store.getState().nodes.find((node) => node.id === 'n1')?.position).toEqual({
      x: 0,
      y: 0,
    });

    store.getState().redoPositions();
    expect(store.getState().nodes.find((node) => node.id === 'n1')?.position).toEqual({
      x: 50,
      y: 0,
    });
  });

  it('undo 后新提交清空 redo', () => {
    const store = makeStore();
    drag(store, 'n1', { x: 10, y: 0 });
    store.getState().undoPositions();
    expect(store.getState().redo).toHaveLength(1);

    drag(store, 'n1', { x: 20, y: 0 });
    expect(store.getState().redo).toEqual([]);
    expect(store.getState().undo.at(-1)).toEqual([
      { id: 'n1', from: { x: 0, y: 0 }, to: { x: 20, y: 0 } },
    ]);
  });

  it('历史超过上限时裁剪到 HISTORY_LIMIT', () => {
    const store = makeStore();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) drag(store, 'n1', { x: i + 1, y: 0 });
    expect(store.getState().undo).toHaveLength(HISTORY_LIMIT);
    expect(store.getState().undo.at(-1)).toEqual([
      { id: 'n1', from: { x: HISTORY_LIMIT + 4, y: 0 }, to: { x: HISTORY_LIMIT + 5, y: 0 } },
    ]);
  });
});

describe('persistPositions', () => {
  it('提交拖拽后按项目前缀保存移动', () => {
    const store = makeStore();
    drag(store, 'n1', { x: 42, y: 7 });
    expect(api).toHaveBeenCalledWith('/api/projects/p1/nodes/positions', {
      method: 'PATCH',
      body: JSON.stringify({ moves: [{ id: 'n1', position: { x: 42, y: 7 } }] }),
    });
  });

  it('undo/redo 同样触发保存', () => {
    const store = makeStore();
    drag(store, 'n1', { x: 42, y: 7 });
    vi.mocked(api).mockClear();

    store.getState().undoPositions();
    expect(api).toHaveBeenCalledWith('/api/projects/p1/nodes/positions', {
      method: 'PATCH',
      body: JSON.stringify({ moves: [{ id: 'n1', position: { x: 0, y: 0 } }] }),
    });
  });
});
