import { create } from 'zustand';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { api } from './api';
import type { ImportResponse, Project, ProjectNode, Run, ShotData } from './types';

const NODE_WIDTH = 360;

function toFlowNode(node: ProjectNode): Node<ShotData> {
  return {
    id: node.id,
    type: 'shot',
    position: node.position,
    data: node.data,
    style: { width: NODE_WIDTH },
  };
}

function toFlowEdge(edge: { id: string; source: string; target: string }): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    selectable: false,
    style: {
      stroke: 'rgba(226, 169, 103, 0.42)',
      strokeWidth: 1.3,
      strokeDasharray: '3 7',
    },
  };
}

function patchNodeList(nodes: Node<ShotData>[], serverNode: ProjectNode): Node<ShotData>[] {
  return nodes.map((node) =>
    node.id === serverNode.id
      ? { ...node, position: serverNode.position, data: serverNode.data }
      : node,
  );
}

interface WorkbenchState {
  project: Project | null;
  nodes: Node<ShotData>[];
  edges: Edge[];
  ready: boolean;
  busy: string | null;
  toast: string | null;
  selectedId: string | null;
  importOpen: boolean;
  lightbox: { nodeId: string; index: number } | null;
  revision: number;

  load: () => Promise<void>;
  onNodesChange: (changes: NodeChange<Node<ShotData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  persistPosition: (id: string) => Promise<void>;
  selectNode: (id: string | null) => void;
  setImportOpen: (open: boolean) => void;
  setLightbox: (value: { nodeId: string; index: number } | null) => void;
  notify: (message: string | null) => void;
  applyRun: (nodeId: string, run: Run, usage?: number) => void;
  generate: (nodeId: string, options?: { n?: number; force?: boolean; seed?: number }) => Promise<void>;
  batch: (scope: 'missing' | 'all', n?: number, force?: boolean) => Promise<void>;
  patchNode: (nodeId: string, patch: Record<string, unknown>) => Promise<void>;
  selectCandidate: (nodeId: string, candidateId: string) => Promise<void>;
  clearRun: (nodeId: string) => Promise<void>;
  resetUsage: () => Promise<void>;
  importCsv: (csv: string, name: string, sourceFile?: string) => Promise<void>;
}

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  project: null,
  nodes: [],
  edges: [],
  ready: false,
  busy: null,
  toast: null,
  selectedId: null,
  importOpen: false,
  lightbox: null,
  revision: 0,

  load: async () => {
    try {
      const project = await api<Project>('/api/project');
      set({
        project,
        nodes: project.nodes.map(toFlowNode),
        edges: project.edges.map(toFlowEdge),
        ready: true,
      });
    } catch (error) {
      set({ ready: true, toast: `加载失败：${(error as Error).message}` });
    }
  },

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
      await api(`/api/nodes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ position: node.position }),
      });
    } catch {
      // 位置保存失败不阻塞拖拽，下次拖动会重试
    }
  },

  selectNode: (id) => set({ selectedId: id }),
  setImportOpen: (open) => set({ importOpen: open }),
  setLightbox: (value) => set({ lightbox: value }),
  notify: (message) => set({ toast: message }),

  applyRun: (nodeId, run, usage) => {
    const current = get();
    set({
      nodes: current.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, run } } : node,
      ),
      project:
        usage !== undefined && current.project
          ? { ...current.project, config: { ...current.project.config, usage } }
          : current.project,
    });
  },

  generate: async (nodeId, options = {}) => {
    try {
      const res = await api<{ queued: number; skipped: number }>(
        `/api/nodes/${nodeId}/generate`,
        { method: 'POST', body: JSON.stringify(options) },
      );
      if (!res.queued && res.skipped) {
        get().notify('相同参数的图已经生成过，已跳过。需要重跑请勾选「强制重跑」');
      }
    } catch (error) {
      get().notify(`生成失败：${(error as Error).message}`);
    }
  },

  batch: async (scope, n = 4, force = false) => {
    try {
      set({ busy: 'batch' });
      const res = await api<{ queued: number; skipped: number; total: number }>(
        '/api/generate/batch',
        { method: 'POST', body: JSON.stringify({ scope, n, force }) },
      );
      get().notify(
        res.queued
          ? `已加入队列 ${res.queued} 个镜头${res.skipped ? `，跳过 ${res.skipped} 个` : ''}`
          : `没有需要生成的镜头（共 ${res.total} 个）`,
      );
    } catch (error) {
      get().notify(`批量生成失败：${(error as Error).message}`);
    } finally {
      set({ busy: null });
    }
  },

  patchNode: async (nodeId, patch) => {
    try {
      const res = await api<{ node: ProjectNode }>(`/api/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
      get().notify('已保存');
    } catch (error) {
      get().notify(`保存失败：${(error as Error).message}`);
    }
  },

  selectCandidate: async (nodeId, candidateId) => {
    try {
      const res = await api<{ node: ProjectNode }>(`/api/nodes/${nodeId}/select`, {
        method: 'POST',
        body: JSON.stringify({ candidateId }),
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
    } catch (error) {
      get().notify(`选择失败：${(error as Error).message}`);
    }
  },

  clearRun: async (nodeId) => {
    try {
      const res = await api<{ node: ProjectNode }>(`/api/nodes/${nodeId}/run`, {
        method: 'DELETE',
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
    } catch (error) {
      get().notify(`清空失败：${(error as Error).message}`);
    }
  },

  resetUsage: async () => {
    try {
      const res = await api<{ usage: number }>('/api/usage/reset', { method: 'POST' });
      const project = get().project;
      if (project) {
        set({ project: { ...project, config: { ...project.config, usage: res.usage } } });
      }
      get().notify('今日用量已重置');
    } catch (error) {
      get().notify(`重置失败：${(error as Error).message}`);
    }
  },

  importCsv: async (csv, name, sourceFile) => {
    try {
      set({ busy: 'import' });
      const res = await api<ImportResponse>('/api/import', {
        method: 'POST',
        body: JSON.stringify({ csv, name, sourceFile }),
      });
      set({
        project: res.project,
        nodes: res.project.nodes.map(toFlowNode),
        edges: res.project.edges.map(toFlowEdge),
        revision: get().revision + 1,
        selectedId: null,
        lightbox: null,
        importOpen: false,
        ready: true,
        toast: `已导入 ${res.stats.count} 个镜头（A ${res.stats.laneA} / B ${res.stats.laneB}）${
          res.stats.reused ? `，复用 ${res.stats.reused} 组已出图` : ''
        }${res.stats.warnings.length ? `，${res.stats.warnings.length} 条提示` : ''}`,
      });
    } catch (error) {
      get().notify(`导入失败：${(error as Error).message}`);
    } finally {
      set({ busy: null });
    }
  },
}));
