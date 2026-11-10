import { api, apiUpload } from '../api';
import type { ProjectNode, Run, ShotData } from '../types';
import { patchNodeList, projectBase } from './model';
import { errorMessage } from '../utils/error';
import type { SliceCreator } from './base';

export interface ShotsSlice {
  applyRun: (nodeId: string, run: Run, usage?: number) => void;
  generate: (nodeId: string, options?: { n?: number; force?: boolean; seed?: number }) => Promise<void>;
  patchNode: (nodeId: string, patch: Record<string, unknown>) => Promise<void>;
  selectCandidate: (nodeId: string, candidateId: string) => Promise<void>;
  uploadImage: (nodeId: string, file: File) => Promise<void>;
  uploadVideo: (nodeId: string, file: File) => Promise<void>;
  removeVideo: (nodeId: string) => Promise<void>;
  clearRun: (nodeId: string) => Promise<void>;
  batchNodes: (nodeIds: string[], force?: boolean) => Promise<void>;
}

export const createShotsSlice: SliceCreator<ShotsSlice> = (set, get) => ({
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
      get().notify(`生成失败：${errorMessage(error)}`, 'error');
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
      get().notify(`保存失败：${errorMessage(error)}`, 'error');
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
      get().notify(`选择失败：${errorMessage(error)}`, 'error');
    }
  },

  uploadImage: async (nodeId, file) => {
    try {
      const res = await apiUpload<{ node: ProjectNode }>(
        `${projectBase(get())}/nodes/${nodeId}/upload`,
        file,
      );
      set({ nodes: patchNodeList(get().nodes, res.node) });
      get().notify('已上传首帧', 'success');
    } catch (error) {
      get().notify(`上传失败：${errorMessage(error)}`, 'error');
    }
  },

  uploadVideo: async (nodeId, file) => {
    try {
      const res = await apiUpload<{ node: ProjectNode }>(
        `${projectBase(get())}/nodes/${nodeId}/video`,
        file,
      );
      set({ nodes: patchNodeList(get().nodes, res.node) });
      get().notify('已上传镜头视频', 'success');
    } catch (error) {
      get().notify(`上传视频失败：${errorMessage(error)}`, 'error');
    }
  },

  removeVideo: async (nodeId) => {
    try {
      const res = await api<{ node: ProjectNode }>(`${projectBase(get())}/nodes/${nodeId}/video`, {
        method: 'DELETE',
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
    } catch (error) {
      get().notify(`移除视频失败：${errorMessage(error)}`, 'error');
    }
  },

  clearRun: async (nodeId) => {
    try {
      const res = await api<{ node: ProjectNode }>(`${projectBase(get())}/nodes/${nodeId}/run`, {
        method: 'DELETE',
      });
      set({ nodes: patchNodeList(get().nodes, res.node) });
    } catch (error) {
      get().notify(`清空失败：${errorMessage(error)}`, 'error');
    }
  },

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
      get().notify(`批量生成失败：${errorMessage(error)}`, 'error');
    } finally {
      set({ batchBusy: false });
    }
  },
});
