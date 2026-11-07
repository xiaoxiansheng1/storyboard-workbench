import { create } from 'zustand';
import { toast } from 'sonner';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { api } from './api';
import type {
  ExportJob,
  ExportList,
  ExportOptions,
  ImportResponse,
  Project,
  ProjectNode,
  Run,
  ShotData,
  SystemSettings,
  WorkbenchConfig,
} from './types';

const NODE_WIDTH = 360;
const THEME_KEY = 'storyboard-theme';

export type Theme = 'dark' | 'light';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // localStorage 不可用时退回系统偏好
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

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
      stroke: 'var(--edge)',
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
  selectedId: string | null;
  importOpen: boolean;
  settingsOpen: boolean;
  settings: SystemSettings | null;
  lightbox: { nodeId: string; index: number } | null;
  revision: number;
  theme: Theme;
  exportOpen: boolean;
  exportJob: ExportJob | null;
  exportHistory: ExportJob[];
  exportMissing: number[];
  exportError: string | null;
  exportStarting: boolean;
  batchOpen: boolean;
  batchBusy: boolean;

  load: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  onNodesChange: (changes: NodeChange<Node<ShotData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  persistPosition: (id: string) => Promise<void>;
  selectNode: (id: string | null) => void;
  setImportOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setBatchOpen: (open: boolean) => void;
  clearSelection: () => void;
  batchNodes: (nodeIds: string[], force?: boolean) => Promise<void>;
  loadExports: () => Promise<void>;
  startExport: (options: ExportOptions) => Promise<void>;
  cancelExport: (id: string) => Promise<void>;
  viewExport: (job: ExportJob | null) => void;
  applyExport: (job: ExportJob) => void;
  loadSettings: () => Promise<void>;
  saveSettings: (patch: {
    provider?: string;
    imageModel?: string;
    apiKey?: string;
    promptLang?: 'en' | 'zh';
    concurrency?: number;
    dailyCap?: number;
    maxBatch?: number;
  }) => Promise<boolean>;
  applyConfig: (config: WorkbenchConfig) => void;
  setLightbox: (value: { nodeId: string; index: number } | null) => void;
  notify: (message: string, tone?: 'default' | 'success' | 'error') => void;
  applyRun: (nodeId: string, run: Run, usage?: number) => void;
  generate: (nodeId: string, options?: { n?: number; force?: boolean; seed?: number }) => Promise<void>;
  patchNode: (nodeId: string, patch: Record<string, unknown>) => Promise<void>;
  selectCandidate: (nodeId: string, candidateId: string) => Promise<void>;
  uploadImage: (nodeId: string, file: File) => Promise<void>;
  clearRun: (nodeId: string) => Promise<void>;
  resetUsage: () => Promise<void>;
  importCsv: (csv: string, name: string, sourceFile?: string) => Promise<ImportResponse | null>;
}

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  project: null,
  nodes: [],
  edges: [],
  ready: false,
  busy: null,
  selectedId: null,
  importOpen: false,
  settingsOpen: false,
  settings: null,
  lightbox: null,
  revision: 0,
  theme: readTheme(),
  exportOpen: false,
  exportJob: null,
  exportHistory: [],
  exportMissing: [],
  exportError: null,
  exportStarting: false,
  batchOpen: false,
  batchBusy: false,

  setTheme: (theme) => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // 忽略持久化失败
    }
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },

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
      set({ ready: true });
      get().notify(`加载失败：${(error as Error).message}`, 'error');
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
  setSettingsOpen: (open) => {
    set({ settingsOpen: open });
    if (open) void get().loadSettings();
  },

  setExportOpen: (open) => {
    set({ exportOpen: open, exportError: null });
    if (open) void get().loadExports();
  },

  setBatchOpen: (open) => set({ batchOpen: open }),

  clearSelection: () =>
    set({
      selectedId: null,
      nodes: get().nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
    }),

  batchNodes: async (nodeIds, force = false) => {
    if (!nodeIds.length) return;
    try {
      set({ batchBusy: true });
      const res = await api<{ queued: number; skipped: number; total: number }>(
        '/api/generate/batch',
        { method: 'POST', body: JSON.stringify({ nodeIds, n: 1, force }) },
      );
      if (res.queued) {
        set({ batchOpen: false });
        get().clearSelection();
        get().notify(
          `已加入队列 ${res.queued} 个镜头${res.skipped ? `，跳过 ${res.skipped} 个` : ''}`,
        );
        return;
      }
      get().notify(
        `没有可生成的镜头${res.skipped ? `，${res.skipped} 个已跳过` : ''}。可勾选「已有首帧也重新生成」后重试`,
      );
    } catch (error) {
      get().notify(`批量生成失败：${(error as Error).message}`, 'error');
    } finally {
      set({ batchBusy: false });
    }
  },

  loadExports: async () => {
    try {
      const list = await api<ExportList>('/api/exports');
      const current = get().exportJob;
      const selected =
        list.active ||
        (current && list.jobs.some((job) => job.id === current.id) ? current : null) ||
        list.jobs[0] ||
        null;
      set({ exportHistory: list.jobs, exportJob: selected });
    } catch (error) {
      get().notify(`读取合成记录失败：${(error as Error).message}`, 'error');
    }
  },

  startExport: async (options) => {
    try {
      set({ exportStarting: true, exportError: null, exportMissing: [] });
      const res = await api<{ job: ExportJob }>('/api/exports', {
        method: 'POST',
        body: JSON.stringify(options),
      });
      set({ exportJob: res.job });
    } catch (error) {
      const payload = (error as Error & { payload?: { missing?: { no: number }[] } }).payload;
      set({
        exportError: (error as Error).message,
        exportMissing: (payload?.missing || []).map((item) => item.no),
      });
    } finally {
      set({ exportStarting: false });
    }
  },

  cancelExport: async (id) => {
    try {
      const res = await api<{ job: ExportJob }>(`/api/exports/${id}/cancel`, { method: 'POST' });
      set({ exportJob: res.job });
    } catch (error) {
      get().notify(`取消失败：${(error as Error).message}`, 'error');
    }
  },

  viewExport: (job) => set({ exportJob: job, exportError: null, exportMissing: [] }),

  applyExport: (job) => {
    const current = get().exportJob;
    const history = get().exportHistory;
    const finished = job.status === 'done' || job.status === 'error' || job.status === 'canceled';
    const nextHistory = finished
      ? [job, ...history.filter((item) => item.id !== job.id)].slice(0, 20)
      : history;
    set({
      exportHistory: nextHistory,
      exportJob: !current || current.id === job.id || finished ? job : current,
    });
  },

  loadSettings: async () => {
    try {
      const value = await api<SystemSettings>('/api/settings');
      set({ settings: value });
    } catch (error) {
      get().notify(`读取设置失败：${(error as Error).message}`, 'error');
    }
  },

  saveSettings: async (patch) => {
    try {
      set({ busy: 'settings' });
      const res = await api<{ settings: SystemSettings; config: WorkbenchConfig }>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      const project = get().project;
      set({
        settings: res.settings,
        project: project ? { ...project, config: res.config } : project,
      });
      get().notify('设置已保存', 'success');
      return true;
    } catch (error) {
      get().notify(`保存设置失败：${(error as Error).message}`, 'error');
      return false;
    } finally {
      set({ busy: null });
    }
  },

  applyConfig: (config) => {
    const project = get().project;
    if (project) set({ project: { ...project, config } });
  },

  setLightbox: (value) => set({ lightbox: value }),
  notify: (message, tone = 'default') => {
    if (!message) return;
    if (tone === 'error') toast.error(message, { duration: 6000 });
    else if (tone === 'success') toast.success(message);
    else toast(message);
  },

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
      get().notify(`生成失败：${(error as Error).message}`, 'error');
    }
  },

  patchNode: async (nodeId, patch) => {
    try {
      const res = await api<{ node: ProjectNode }>(`/api/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
      get().notify('已保存', 'success');
    } catch (error) {
      get().notify(`保存失败：${(error as Error).message}`, 'error');
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
      get().notify(`选择失败：${(error as Error).message}`, 'error');
    }
  },

  uploadImage: async (nodeId, file) => {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
      const res = await api<{ node: ProjectNode }>(`/api/nodes/${nodeId}/upload`, {
        method: 'POST',
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
      get().notify('已上传首帧', 'success');
    } catch (error) {
      get().notify(`上传失败：${(error as Error).message}`, 'error');
    }
  },

  clearRun: async (nodeId) => {
    try {
      const res = await api<{ node: ProjectNode }>(`/api/nodes/${nodeId}/run`, {
        method: 'DELETE',
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
    } catch (error) {
      get().notify(`清空失败：${(error as Error).message}`, 'error');
    }
  },

  resetUsage: async () => {
    try {
      const res = await api<{ usage: number }>('/api/usage/reset', { method: 'POST' });
      const project = get().project;
      if (project) {
        set({ project: { ...project, config: { ...project.config, usage: res.usage } } });
      }
      get().notify('今日用量已重置', 'success');
    } catch (error) {
      get().notify(`重置失败：${(error as Error).message}`, 'error');
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
        ready: true,
      });
      return res;
    } catch (error) {
      get().notify(`导入失败：${(error as Error).message}`, 'error');
      return null;
    } finally {
      set({ busy: null });
    }
  },
}));
