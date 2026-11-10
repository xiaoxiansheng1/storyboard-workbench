import { create } from 'zustand';
import { toast } from 'sonner';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import { api } from './api';
import type {
  AudioData,
  AudioExportJob,
  AudioExportList,
  AudioExportOptions,
  AudioImportResponse,
  AudioInferMode,
  AudioRun,
  AudioSplitResponse,
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
  WorkbenchNodeData,
} from './types';

const NODE_WIDTH = 360;
const AUDIO_WIDTH = 330;
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

function toFlowNode(node: ProjectNode): Node<WorkbenchNodeData> {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    data: node.data,
    style: { width: node.type === 'audio' ? AUDIO_WIDTH : NODE_WIDTH },
  };
}

function toFlowEdge(edge: { id: string; source: string; target: string; kind?: string }): Edge {
  const audio = edge.kind === 'audio';
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    selectable: audio,
    interactionWidth: audio ? 16 : 20,
    className: audio ? 'audio-edge' : 'shot-edge',
    data: { kind: audio ? 'audio' : 'shot' },
    style: audio
      ? {
          stroke: 'var(--edge)',
          strokeWidth: 1.3,
          strokeDasharray: '3 7',
        }
      : {
          stroke: 'var(--edge)',
          strokeWidth: 1.3,
          strokeDasharray: '3 7',
        },
  };
}

function patchNodeList(
  nodes: Node<WorkbenchNodeData>[],
  serverNode: ProjectNode,
): Node<WorkbenchNodeData>[] {
  return nodes.map((node) =>
    node.id === serverNode.id
      ? { ...node, position: serverNode.position, data: serverNode.data }
      : node,
  );
}

type PositionChange = { id: string; from: XYPosition; to: XYPosition };

const HISTORY_LIMIT = 50;

function withPositions(
  nodes: Node<WorkbenchNodeData>[],
  positions: Record<string, XYPosition>,
): Node<WorkbenchNodeData>[] {
  return nodes.map((node) =>
    positions[node.id] ? { ...node, position: { ...positions[node.id] } } : node,
  );
}

function projectBase(state: { projectId: string | null }): string {
  return state.projectId ? `/api/projects/${state.projectId}` : '/api';
}

function patchAudioList(
  nodes: Node<WorkbenchNodeData>[],
  serverNode: ProjectNode,
): Node<WorkbenchNodeData>[] {
  return nodes.map((node) =>
    node.id === serverNode.id
      ? { ...node, position: serverNode.position, data: serverNode.data as AudioData }
      : node,
  );
}

function withAudioData(
  nodes: Node<WorkbenchNodeData>[],
  id: string,
  patch: Partial<AudioData>,
): Node<WorkbenchNodeData>[] {
  return nodes.map((node) =>
    node.id === id ? { ...node, data: { ...(node.data as AudioData), ...patch } } : node,
  );
}

function withAudioNos(
  nodes: Node<WorkbenchNodeData>[],
  renumbered: { id: string; position?: { x: number; y: number }; data: { no: number } }[],
): Node<WorkbenchNodeData>[] {
  const map = new Map(renumbered.map((item) => [item.id, item]));
  return nodes.map((node) => {
    const item = map.get(node.id);
    if (!item) return node;
    return {
      ...node,
      ...(item.position ? { position: item.position } : null),
      data: { ...(node.data as AudioData), no: Number(item.data?.no) },
    };
  });
}

interface WorkbenchState {
  projectId: string | null;
  notFound: boolean;
  project: Project | null;
  nodes: Node<WorkbenchNodeData>[];
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
  taskOpen: boolean;
  focusSeq: number;
  focusTarget: string | null;
  audioAddOpen: boolean;
  audioExportOpen: boolean;
  audioExportJob: AudioExportJob | null;
  audioExportHistory: AudioExportJob[];
  audioExportMissing: number[];
  audioExportError: string | null;
  audioExportStarting: boolean;
  undo: PositionChange[][];
  redo: PositionChange[][];
  dragOrigin: Record<string, XYPosition>;

  load: (projectId: string) => Promise<void>;
  resync: () => Promise<void>;
  cancelJobs: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  onNodesChange: (changes: NodeChange<Node<WorkbenchNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  persistPosition: (id: string) => Promise<void>;
  beginPositionDrag: (ids: string[]) => void;
  commitPositionDrag: () => void;
  undoPositions: () => void;
  redoPositions: () => void;
  selectNode: (id: string | null) => void;
  setImportOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setBatchOpen: (open: boolean) => void;
  setTaskOpen: (open: boolean) => void;
  focusNode: (nodeId: string) => void;
  cancelTask: (nodeId: string) => Promise<void>;
  setAudioAddOpen: (open: boolean) => void;
  setAudioExportOpen: (open: boolean) => void;
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
    maxBatch?: number;
    audioBaseUrl?: string;
    audioInferMode?: AudioInferMode;
  }) => Promise<boolean>;
  applyConfig: (config: WorkbenchConfig) => void;
  setLightbox: (value: { nodeId: string; index: number } | null) => void;
  notify: (message: string, tone?: 'default' | 'success' | 'error') => void;
  applyRun: (nodeId: string, run: Run, usage?: number) => void;
  generate: (nodeId: string, options?: { n?: number; force?: boolean; seed?: number }) => Promise<void>;
  patchNode: (nodeId: string, patch: Record<string, unknown>) => Promise<void>;
  selectCandidate: (nodeId: string, candidateId: string) => Promise<void>;
  uploadImage: (nodeId: string, file: File) => Promise<void>;
  uploadVideo: (nodeId: string, file: File) => Promise<void>;
  removeVideo: (nodeId: string) => Promise<void>;
  clearRun: (nodeId: string) => Promise<void>;
  resetUsage: () => Promise<void>;
  importCsv: (csv: string, name: string, sourceFile?: string) => Promise<ImportResponse | null>;
  createAudioNode: (text: string) => Promise<ProjectNode | null>;
  createAudioNodes: (texts: string[]) => Promise<number>;
  splitAudioText: (text: string, chunkChars: number) => Promise<AudioSplitResponse | null>;
  patchAudioNode: (nodeId: string, text: string) => Promise<boolean>;
  connectAudio: (source: string, target: string) => Promise<void>;
  removeAudioLink: (edgeId: string) => Promise<void>;
  deleteAudioNode: (nodeId: string) => Promise<void>;
  generateAudio: (nodeId: string, force?: boolean) => Promise<void>;
  batchAudio: (nodeIds: string[], force?: boolean) => Promise<void>;
  selectAudioCandidate: (nodeId: string, candidateId: string) => Promise<void>;
  clearAudioRun: (nodeId: string) => Promise<void>;
  uploadVoice: (file: File) => Promise<void>;
  removeVoice: () => Promise<void>;
  applyAudioRun: (nodeId: string, run: AudioRun) => void;
  loadAudioExports: () => Promise<void>;
  startAudioExport: (options: AudioExportOptions) => Promise<void>;
  cancelAudioExport: (id: string) => Promise<void>;
  viewAudioExport: (job: AudioExportJob | null) => void;
  applyAudioExport: (job: AudioExportJob) => void;
}

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  projectId: null,
  notFound: false,
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
  taskOpen: false,
  focusSeq: 0,
  focusTarget: null,
  audioAddOpen: false,
  audioExportOpen: false,
  audioExportJob: null,
  audioExportHistory: [],
  audioExportMissing: [],
  audioExportError: null,
  audioExportStarting: false,
  undo: [],
  redo: [],
  dragOrigin: {},

  setTheme: (theme) => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // 忽略持久化失败
    }
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },

  load: async (projectId) => {
    set({
      projectId,
      notFound: false,
      project: null,
      nodes: [],
      edges: [],
      ready: false,
      selectedId: null,
      lightbox: null,
      importOpen: false,
      settingsOpen: false,
      exportOpen: false,
      exportJob: null,
      exportHistory: [],
      exportMissing: [],
      exportError: null,
      batchOpen: false,
      taskOpen: false,
      audioAddOpen: false,
      audioExportOpen: false,
      audioExportJob: null,
      audioExportHistory: [],
      audioExportMissing: [],
      audioExportError: null,
      revision: 0,
      undo: [],
      redo: [],
      dragOrigin: {},
    });
    try {
      const project = await api<Project>(`/api/projects/${projectId}/project`);
      set({
        project,
        nodes: project.nodes.map(toFlowNode),
        edges: project.edges.map(toFlowEdge),
        ready: true,
      });
    } catch (error) {
      const message = (error as Error).message;
      set({ ready: true, notFound: message.includes('项目不存在') });
      if (!message.includes('项目不存在')) get().notify(`加载失败：${message}`, 'error');
    }
  },

  resync: async () => {
    const { projectId, nodes } = get();
    if (!projectId) return;
    try {
      const [project, exports, audioExports] = await Promise.all([
        api<Project>(`/api/projects/${projectId}/project`),
        api<ExportList>(`/api/projects/${projectId}/exports`).catch(() => null),
        api<AudioExportList>(`/api/projects/${projectId}/audio/exports`).catch(() => null),
      ]);
      const positions = new Map(nodes.map((node) => [node.id, node.position]));
      set({
        project,
        nodes: project.nodes.map((node) => ({
          ...toFlowNode(node),
          position: positions.get(node.id) || node.position,
        })),
        edges: project.edges.map(toFlowEdge),
        ...(exports
          ? { exportHistory: exports.jobs, exportJob: exports.active || get().exportJob }
          : null),
        ...(audioExports
          ? {
              audioExportHistory: audioExports.jobs,
              audioExportJob: audioExports.active || get().audioExportJob,
            }
          : null),
      });
    } catch {
      // 重连同步失败时保持现有画面，后续事件仍会持续更新
    }
  },

  cancelJobs: async () => {
    try {
      await api(`${projectBase(get())}/jobs/cancel`, { method: 'POST' });
      get().notify('已请求停止生成', 'success');
    } catch (error) {
      get().notify(`停止失败：${(error as Error).message}`, 'error');
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

  setTaskOpen: (open) => set({ taskOpen: open }),

  focusNode: (nodeId) =>
    set({
      selectedId: nodeId,
      taskOpen: false,
      focusTarget: nodeId,
      focusSeq: get().focusSeq + 1,
    }),

  cancelTask: async (nodeId) => {
    try {
      await api(`${projectBase(get())}/jobs/${nodeId}/cancel`, { method: 'POST' });
    } catch (error) {
      get().notify(`取消失败：${(error as Error).message}`, 'error');
    }
  },

  setAudioAddOpen: (open) => set({ audioAddOpen: open }),

  setAudioExportOpen: (open) => {
    set({ audioExportOpen: open, audioExportError: null });
    if (open) void get().loadAudioExports();
  },

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
        `${projectBase(get())}/generate/batch`,
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
      const list = await api<ExportList>(`${projectBase(get())}/exports`);
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
      const res = await api<{ job: ExportJob }>(`${projectBase(get())}/exports`, {
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
      const res = await api<{ job: ExportJob }>(`${projectBase(get())}/exports/${id}/cancel`, {
        method: 'POST',
      });
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
      const projectId = get().projectId;
      const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      const value = await api<SystemSettings>(`/api/settings${suffix}`);
      set({ settings: value });
    } catch (error) {
      get().notify(`读取设置失败：${(error as Error).message}`, 'error');
    }
  },

  saveSettings: async (patch) => {
    try {
      set({ busy: 'settings' });
      const projectId = get().projectId;
      const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      const res = await api<{ settings: SystemSettings; config: WorkbenchConfig }>(
        `/api/settings${suffix}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
      );
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
    if (!project) return;
    // 设置广播是全局的，不带某个项目的用量，避免把当前项目用量清成 0
    set({ project: { ...project, config: { ...config, usage: project.config.usage } } });
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
        node.id === nodeId && node.type === 'shot'
          ? { ...node, data: { ...(node.data as ShotData), run } }
          : node,
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
        `${projectBase(get())}/nodes/${nodeId}/generate`,
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
      const res = await api<{ node: ProjectNode }>(`${projectBase(get())}/nodes/${nodeId}`, {
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
      const res = await api<{ node: ProjectNode }>(`${projectBase(get())}/nodes/${nodeId}/select`, {
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
      const res = await api<{ node: ProjectNode }>(`${projectBase(get())}/nodes/${nodeId}/upload`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
      get().notify('已上传首帧', 'success');
    } catch (error) {
      get().notify(`上传失败：${(error as Error).message}`, 'error');
    }
  },

  uploadVideo: async (nodeId, file) => {
    try {
      const res = await api<{ node: ProjectNode }>(`${projectBase(get())}/nodes/${nodeId}/video`, {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
      get().notify('已上传镜头视频', 'success');
    } catch (error) {
      get().notify(`上传视频失败：${(error as Error).message}`, 'error');
    }
  },

  removeVideo: async (nodeId) => {
    try {
      const res = await api<{ node: ProjectNode }>(`${projectBase(get())}/nodes/${nodeId}/video`, {
        method: 'DELETE',
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
    } catch (error) {
      get().notify(`移除视频失败：${(error as Error).message}`, 'error');
    }
  },

  clearRun: async (nodeId) => {
    try {
      const res = await api<{ node: ProjectNode }>(`${projectBase(get())}/nodes/${nodeId}/run`, {
        method: 'DELETE',
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
    } catch (error) {
      get().notify(`清空失败：${(error as Error).message}`, 'error');
    }
  },

  resetUsage: async () => {
    try {
      const res = await api<{ usage: number }>(`${projectBase(get())}/usage/reset`, {
        method: 'POST',
      });
      const { project, settings } = get();
      set({
        project: project ? { ...project, config: { ...project.config, usage: res.usage } } : project,
        settings: settings ? { ...settings, usage: res.usage } : settings,
      });
      get().notify('今日用量已重置', 'success');
    } catch (error) {
      get().notify(`重置失败：${(error as Error).message}`, 'error');
    }
  },

  createAudioNode: async (text) => {
    try {
      const res = await api<{
        node: ProjectNode;
        edges?: { id: string; source: string; target: string; kind?: string }[];
      }>(`${projectBase(get())}/audio/nodes`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      set({
        nodes: [...get().nodes, toFlowNode(res.node)],
        edges: [...get().edges, ...(res.edges || []).map(toFlowEdge)],
      });
      return res.node;
    } catch (error) {
      get().notify(`新建音频失败：${(error as Error).message}`, 'error');
      return null;
    }
  },

  createAudioNodes: async (texts) => {
    try {
      const res = await api<{
        nodes: ProjectNode[];
        edges?: { id: string; source: string; target: string; kind?: string }[];
      }>(`${projectBase(get())}/audio/nodes/batch`, {
        method: 'POST',
        body: JSON.stringify({ texts }),
      });
      set({
        nodes: [...get().nodes, ...res.nodes.map(toFlowNode)],
        edges: [...get().edges, ...(res.edges || []).map(toFlowEdge)],
      });
      return res.nodes.length;
    } catch (error) {
      get().notify(`导入文本失败：${(error as Error).message}`, 'error');
      return 0;
    }
  },

  splitAudioText: async (text, chunkChars) => {
    try {
      return await api<AudioSplitResponse>(`${projectBase(get())}/audio/split`, {
        method: 'POST',
        body: JSON.stringify({ text, chunkChars }),
      });
    } catch (error) {
      get().notify(`拆分失败：${(error as Error).message}`, 'error');
      return null;
    }
  },

  patchAudioNode: async (nodeId, text) => {
    try {
      const res = await api<{ node: ProjectNode }>(`${projectBase(get())}/audio/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ text }),
      });
      set({ nodes: patchAudioList(get().nodes, res.node) });
      get().notify('已保存', 'success');
      return true;
    } catch (error) {
      get().notify(`保存失败：${(error as Error).message}`, 'error');
      return false;
    }
  },

  connectAudio: async (source, target) => {
    const { nodes, edges, projectId } = get();
    if (!projectId || source === target) return;
    const typeOf = (id: string) => nodes.find((node) => node.id === id)?.type;
    if (typeOf(source) !== 'audio' || typeOf(target) !== 'audio') return;
    const links = edges
      .filter(
        (edge) =>
          (edge.data as { kind?: string } | undefined)?.kind === 'audio' &&
          edge.source !== source &&
          edge.target !== target,
      )
      .map((edge) => ({ source: edge.source, target: edge.target }));
    links.push({ source, target });
    try {
      const res = await api<{
        edges: { id: string; source: string; target: string; kind?: string }[];
        nodes: { id: string; data: { no: number } }[];
      }>(`${projectBase(get())}/audio/links`, {
        method: 'PUT',
        body: JSON.stringify({ links }),
      });
      set({
        edges: res.edges.map(toFlowEdge),
        nodes: withAudioNos(get().nodes, res.nodes || []),
      });
    } catch (error) {
      get().notify(`拼接顺序调整失败：${(error as Error).message}`, 'error');
    }
  },

  removeAudioLink: async (edgeId) => {
    const { edges, projectId } = get();
    if (!projectId) return;
    const links = edges
      .filter(
        (edge) =>
          edge.id !== edgeId && (edge.data as { kind?: string } | undefined)?.kind === 'audio',
      )
      .map((edge) => ({ source: edge.source, target: edge.target }));
    try {
      const res = await api<{
        edges: { id: string; source: string; target: string; kind?: string }[];
        nodes: { id: string; data: { no: number } }[];
      }>(`${projectBase(get())}/audio/links`, {
        method: 'PUT',
        body: JSON.stringify({ links }),
      });
      set({
        edges: res.edges.map(toFlowEdge),
        nodes: withAudioNos(get().nodes, res.nodes || []),
      });
      get().notify('已取消连线', 'success');
    } catch (error) {
      get().notify(`取消连线失败：${(error as Error).message}`, 'error');
    }
  },

  deleteAudioNode: async (nodeId) => {
    try {
      const res = await api<{ nodes: { id: string; data: { no: number } }[] }>(
        `${projectBase(get())}/audio/nodes/${nodeId}`,
        { method: 'DELETE' },
      );
      const remaining = get().nodes.filter((node) => node.id !== nodeId);
      set({
        nodes: withAudioNos(remaining, res.nodes || []),
        edges: get().edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
        selectedId: get().selectedId === nodeId ? null : get().selectedId,
      });
      get().notify('音频节点已删除', 'success');
    } catch (error) {
      get().notify(`删除失败：${(error as Error).message}`, 'error');
    }
  },

  generateAudio: async (nodeId, force = false) => {
    try {
      const res = await api<{ queued: number; skipped: number }>(
        `${projectBase(get())}/audio/nodes/${nodeId}/generate`,
        { method: 'POST', body: JSON.stringify({ force }) },
      );
      if (!res.queued && res.skipped) {
        get().notify('文本和音色都没变，已跳过。需要重跑请用「重新生成」');
      }
    } catch (error) {
      get().notify(`音频生成失败：${(error as Error).message}`, 'error');
    }
  },

  batchAudio: async (nodeIds, force = false) => {
    if (!nodeIds.length) return;
    try {
      const res = await api<{ queued: number; skipped: number; total: number }>(
        `${projectBase(get())}/audio/generate/batch`,
        { method: 'POST', body: JSON.stringify({ nodeIds, force }) },
      );
      if (res.queued) {
        get().clearSelection();
        get().notify(
          `已加入配音队列 ${res.queued} 个${res.skipped ? `，跳过 ${res.skipped} 个` : ''}`,
        );
        return;
      }
      get().notify(
        `没有可加入队列的音频${res.skipped ? `（${res.skipped} 个已在队列中或文本为空）` : ''}`,
      );
    } catch (error) {
      get().notify(`批量配音失败：${(error as Error).message}`, 'error');
    }
  },

  selectAudioCandidate: async (nodeId, candidateId) => {
    try {
      const res = await api<{ node: ProjectNode }>(
        `${projectBase(get())}/audio/nodes/${nodeId}/select`,
        { method: 'POST', body: JSON.stringify({ candidateId }) },
      );
      set({ nodes: patchAudioList(get().nodes, res.node) });
    } catch (error) {
      get().notify(`选择失败：${(error as Error).message}`, 'error');
    }
  },

  clearAudioRun: async (nodeId) => {
    try {
      const res = await api<{ node: ProjectNode }>(
        `${projectBase(get())}/audio/nodes/${nodeId}/run`,
        { method: 'DELETE' },
      );
      set({ nodes: patchAudioList(get().nodes, res.node) });
    } catch (error) {
      get().notify(`清空失败：${(error as Error).message}`, 'error');
    }
  },

  uploadVoice: async (file) => {
    try {
      const res = await api<{ audio: SystemSettings['audio'] }>('/api/voice', {
        method: 'POST',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
      });
      const settings = get().settings;
      const project = get().project;
      set({
        settings: settings ? { ...settings, audio: res.audio } : settings,
        project: project
          ? { ...project, config: { ...project.config, audio: res.audio } }
          : project,
      });
      get().notify('参考音色已上传', 'success');
    } catch (error) {
      get().notify(`上传音色失败：${(error as Error).message}`, 'error');
    }
  },

  removeVoice: async () => {
    try {
      const res = await api<{ audio: SystemSettings['audio'] }>('/api/voice', {
        method: 'DELETE',
      });
      const settings = get().settings;
      const project = get().project;
      set({
        settings: settings ? { ...settings, audio: res.audio } : settings,
        project: project
          ? { ...project, config: { ...project.config, audio: res.audio } }
          : project,
      });
      get().notify('已移除参考音色');
    } catch (error) {
      get().notify(`移除失败：${(error as Error).message}`, 'error');
    }
  },

  applyAudioRun: (nodeId, run) => {
    set({ nodes: withAudioData(get().nodes, nodeId, { run }) });
  },

  loadAudioExports: async () => {
    try {
      const list = await api<AudioExportList>(`${projectBase(get())}/audio/exports`);
      const current = get().audioExportJob;
      const selected =
        list.active ||
        (current && list.jobs.some((job) => job.id === current.id) ? current : null) ||
        list.jobs[0] ||
        null;
      set({ audioExportHistory: list.jobs, audioExportJob: selected });
    } catch (error) {
      get().notify(`读取音频合成记录失败：${(error as Error).message}`, 'error');
    }
  },

  startAudioExport: async (options) => {
    try {
      set({ audioExportStarting: true, audioExportError: null, audioExportMissing: [] });
      const res = await api<{ job: AudioExportJob }>(`${projectBase(get())}/audio/exports`, {
        method: 'POST',
        body: JSON.stringify(options),
      });
      set({ audioExportJob: res.job });
    } catch (error) {
      const payload = (error as Error & { payload?: { missing?: { no: number }[] } }).payload;
      set({
        audioExportError: (error as Error).message,
        audioExportMissing: (payload?.missing || []).map((item) => item.no),
      });
    } finally {
      set({ audioExportStarting: false });
    }
  },

  cancelAudioExport: async (id) => {
    try {
      const res = await api<{ job: AudioExportJob }>(
        `${projectBase(get())}/audio/exports/${id}/cancel`,
        { method: 'POST' },
      );
      set({ audioExportJob: res.job });
    } catch (error) {
      get().notify(`取消失败：${(error as Error).message}`, 'error');
    }
  },

  viewAudioExport: (job) =>
    set({ audioExportJob: job, audioExportError: null, audioExportMissing: [] }),

  applyAudioExport: (job) => {
    const current = get().audioExportJob;
    const history = get().audioExportHistory;
    const finished = job.status === 'done' || job.status === 'error' || job.status === 'canceled';
    const nextHistory = finished
      ? [job, ...history.filter((item) => item.id !== job.id)].slice(0, 20)
      : history;
    set({
      audioExportHistory: nextHistory,
      audioExportJob: !current || current.id === job.id || finished ? job : current,
    });
  },

  importCsv: async (csv, name, sourceFile) => {
    try {
      set({ busy: 'import' });
      const res = await api<ImportResponse>(`${projectBase(get())}/import`, {
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
        undo: [],
        redo: [],
        dragOrigin: {},
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
