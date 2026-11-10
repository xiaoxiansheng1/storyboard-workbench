import type { Edge, Node, NodeChange, EdgeChange, XYPosition } from '@xyflow/react';
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { api } from '../api';
import type { WorkbenchNodeData } from '../types';
import { HISTORY_LIMIT, projectBase, withPositions, type PositionChange } from './model';
import type { SliceCreator } from './base';

export interface CanvasSlice {
  nodes: Node<WorkbenchNodeData>[];
  edges: Edge[];
  selectedId: string | null;
  undo: PositionChange[][];
  redo: PositionChange[][];
  dragOrigin: Record<string, XYPosition>;

  onNodesChange: (changes: NodeChange<Node<WorkbenchNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  persistPosition: (id: string) => Promise<void>;
  beginPositionDrag: (ids: string[]) => void;
  commitPositionDrag: () => void;
  undoPositions: () => void;
  redoPositions: () => void;
  selectNode: (id: string | null) => void;
  clearSelection: () => void;
}

export const createCanvasSlice: SliceCreator<CanvasSlice> = (set, get) => ({
  nodes: [],
  edges: [],
  selectedId: null,
  undo: [],
  redo: [],
  dragOrigin: {},

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  persistPosition: async (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    try {
      await api(`${projectBase(get())}/nodes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ position: node.position }),
      });
    } catch {
      // 位置保存失败不阻塞拖拽，下次拖动会重试
    }
  },

  beginPositionDrag: (ids) => {
    const origin: Record<string, XYPosition> = {};
    for (const node of get().nodes) {
      if (ids.includes(node.id)) origin[node.id] = { ...node.position };
    }
    set({ dragOrigin: origin });
  },

  commitPositionDrag: () => {
    const { nodes, dragOrigin } = get();
    const changes: PositionChange[] = [];
    for (const [id, from] of Object.entries(dragOrigin)) {
      const node = nodes.find((n) => n.id === id);
      if (!node) continue;
      if (node.position.x === from.x && node.position.y === from.y) continue;
      changes.push({ id, from, to: { ...node.position } });
    }
    set({ dragOrigin: {} });
    if (!changes.length) return;
    set({ undo: [...get().undo, changes].slice(-HISTORY_LIMIT), redo: [] });
    for (const change of changes) void get().persistPosition(change.id);
  },

  undoPositions: () => {
    const { undo, redo, nodes } = get();
    const step = undo[undo.length - 1];
    if (!step) return;
    const positions = Object.fromEntries(step.map((change) => [change.id, change.from]));
    set({
      nodes: withPositions(nodes, positions),
      undo: undo.slice(0, -1),
      redo: [...redo, step].slice(-HISTORY_LIMIT),
    });
    for (const change of step) void get().persistPosition(change.id);
  },

  redoPositions: () => {
    const { undo, redo, nodes } = get();
    const step = redo[redo.length - 1];
    if (!step) return;
    const positions = Object.fromEntries(step.map((change) => [change.id, change.to]));
    set({
      nodes: withPositions(nodes, positions),
      undo: [...undo, step].slice(-HISTORY_LIMIT),
      redo: redo.slice(0, -1),
    });
    for (const change of step) void get().persistPosition(change.id);
  },

  selectNode: (id) => set({ selectedId: id }),

  clearSelection: () =>
    set({
      selectedId: null,
      nodes: get().nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
    }),
});
