import { api, apiUpload } from '../api';
import type { AudioInferMode, SystemSettings, WorkbenchConfig } from '../types';
import { projectBase } from './model';
import { errorMessage } from '../utils/error';
import type { SliceCreator } from './base';

export interface SettingsSlice {
  settings: SystemSettings | null;

  loadSettings: () => Promise<void>;
  saveSettings: (patch: {
    provider?: string;
    imageModel?: string;
    apiKey?: string;
    promptLang?: 'en' | 'zh';
    imageSize?: string;
    concurrency?: number;
    maxBatch?: number;
    audioBaseUrl?: string;
    audioInferMode?: AudioInferMode;
  }) => Promise<boolean>;
  applyConfig: (config: WorkbenchConfig) => void;
  resetUsage: () => Promise<void>;
  uploadVoice: (file: File) => Promise<void>;
  removeVoice: () => Promise<void>;
}

export const createSettingsSlice: SliceCreator<SettingsSlice> = (set, get) => ({
  settings: null,

  loadSettings: async () => {
    try {
      const projectId = get().projectId;
      const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      const value = await api<SystemSettings>(`/api/settings${suffix}`);
      set({ settings: value });
    } catch (error) {
      get().notify(`读取设置失败：${errorMessage(error)}`, 'error');
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
      get().notify(`保存设置失败：${errorMessage(error)}`, 'error');
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
      get().notify(`重置失败：${errorMessage(error)}`, 'error');
    }
  },

  uploadVoice: async (file) => {
    try {
      const res = await apiUpload<{ audio: SystemSettings['audio'] }>('/api/voice', file, {
        'X-File-Name': encodeURIComponent(file.name),
      });
      const settings = get().settings;
      const project = get().project;
      set({
        settings: settings ? { ...settings, audio: res.audio } : settings,
        project: project ? { ...project, config: { ...project.config, audio: res.audio } } : project,
      });
      get().notify('参考音色已上传', 'success');
    } catch (error) {
      get().notify(`上传音色失败：${errorMessage(error)}`, 'error');
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
        project: project ? { ...project, config: { ...project.config, audio: res.audio } } : project,
      });
      get().notify('已移除参考音色');
    } catch (error) {
      get().notify(`移除失败：${errorMessage(error)}`, 'error');
    }
  },
});
