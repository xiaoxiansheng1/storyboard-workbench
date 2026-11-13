import { api } from '../api';
import { errorMessage } from '../utils/error';
import type { AudioRun, AudioSplitResponse, ProjectNode } from '../types';
import {
  patchAudioList,
  projectBase,
  toFlowEdge,
  toFlowNode,
  withAudioData,
  withAudioNos,
} from './model';
import type { SliceCreator } from './base';

type EdgeShape = { id: string; source: string; target: string; kind?: string };
type RenumberShape = { id: string; position?: { x: number; y: number }; data: { no: number } };

export interface AudioSlice {
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
  applyAudioRun: (nodeId: string, run: AudioRun) => void;
}

export const createAudioSlice: SliceCreator<AudioSlice> = (set, get) => ({
  createAudioNode: async (text) => {
    try {
      const res = await api<{ node: ProjectNode; edges?: EdgeShape[] }>(
        `${projectBase(get())}/audio/nodes`,
        { method: 'POST', body: JSON.stringify({ text }) },
      );
      set({
        nodes: [...get().nodes, toFlowNode(res.node)],
        edges: [...get().edges, ...(res.edges || []).map(toFlowEdge)],
      });
      return res.node;
    } catch (error) {
      get().notify(`新建音频失败：${errorMessage(error)}`, 'error');
      return null;
    }
  },

  createAudioNodes: async (texts) => {
    try {
      const res = await api<{ nodes: ProjectNode[]; edges?: EdgeShape[] }>(
        `${projectBase(get())}/audio/nodes/batch`,
        { method: 'POST', body: JSON.stringify({ texts }) },
      );
      set({
        nodes: [...get().nodes, ...res.nodes.map(toFlowNode)],
        edges: [...get().edges, ...(res.edges || []).map(toFlowEdge)],
      });
      return res.nodes.length;
    } catch (error) {
      get().notify(`导入文本失败：${errorMessage(error)}`, 'error');
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
      get().notify(`拆分失败：${errorMessage(error)}`, 'error');
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
      get().notify(`保存失败：${errorMessage(error)}`, 'error');
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
      const res = await api<{ edges: EdgeShape[]; nodes: RenumberShape[] }>(
        `${projectBase(get())}/audio/links`,
        { method: 'PUT', body: JSON.stringify({ links }) },
      );
      set({
        edges: res.edges.map(toFlowEdge),
        nodes: withAudioNos(get().nodes, res.nodes || []),
      });
    } catch (error) {
      get().notify(`拼接顺序调整失败：${errorMessage(error)}`, 'error');
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
      const res = await api<{ edges: EdgeShape[]; nodes: RenumberShape[] }>(
        `${projectBase(get())}/audio/links`,
        { method: 'PUT', body: JSON.stringify({ links }) },
      );
      set({
        edges: res.edges.map(toFlowEdge),
        nodes: withAudioNos(get().nodes, res.nodes || []),
      });
      get().notify('已取消连线', 'success');
    } catch (error) {
      get().notify(`取消连线失败：${errorMessage(error)}`, 'error');
    }
  },

  deleteAudioNode: async (nodeId) => {
    try {
      const res = await api<{ nodes: RenumberShape[] }>(
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
      get().notify(`删除失败：${errorMessage(error)}`, 'error');
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
      get().notify(`音频生成失败：${errorMessage(error)}`, 'error');
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
      get().notify(`批量配音失败：${errorMessage(error)}`, 'error');
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
      get().notify(`选择失败：${errorMessage(error)}`, 'error');
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
      get().notify(`清空失败：${errorMessage(error)}`, 'error');
    }
  },

  applyAudioRun: (nodeId, run) => {
    set({ nodes: withAudioData(get().nodes, nodeId, { run }) });
  },
});
