import { api } from '../api';
import type { AudioExportList, ExportList, ImportResponse, Project } from '../types';
import { projectBase, toFlowEdge, toFlowNode } from './model';
import { errorMessage } from '../utils/error';
import type { SliceCreator } from './base';

export interface ProjectSlice {
  projectId: string | null;
  notFound: boolean;
  project: Project | null;
  ready: boolean;
  busy: string | null;
  revision: number;

  load: (projectId: string) => Promise<void>;
  resync: () => Promise<void>;
  cancelJobs: () => Promise<void>;
  importCsv: (csv: string, name: string, sourceFile?: string) => Promise<ImportResponse | null>;
}

export const createProjectSlice: SliceCreator<ProjectSlice> = (set, get) => ({
  projectId: null,
  notFound: false,
  project: null,
  ready: false,
  busy: null,
  revision: 0,

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
      const message = errorMessage(error);
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
      get().notify(`停止失败：${errorMessage(error)}`, 'error');
    }
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
      get().notify(`导入失败：${errorMessage(error)}`, 'error');
      return null;
    } finally {
      set({ busy: null });
    }
  },
});
