import { api } from '../api';
import type { AudioExportJob, AudioExportList, AudioExportOptions } from '../types';
import { projectBase } from './model';
import { errorMessage, errorPayload } from '../utils/error';
import type { SliceCreator } from './base';

export interface AudioExportsSlice {
  audioExportJob: AudioExportJob | null;
  audioExportHistory: AudioExportJob[];
  audioExportMissing: number[];
  audioExportError: string | null;
  audioExportStarting: boolean;

  loadAudioExports: () => Promise<void>;
  startAudioExport: (options: AudioExportOptions) => Promise<void>;
  cancelAudioExport: (id: string) => Promise<void>;
  viewAudioExport: (job: AudioExportJob | null) => void;
  applyAudioExport: (job: AudioExportJob) => void;
}

export const createAudioExportsSlice: SliceCreator<AudioExportsSlice> = (set, get) => ({
  audioExportJob: null,
  audioExportHistory: [],
  audioExportMissing: [],
  audioExportError: null,
  audioExportStarting: false,

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
      get().notify(`读取音频合成记录失败：${errorMessage(error)}`, 'error');
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
      const payload = errorPayload<{ missing?: { no: number }[] }>(error);
      set({
        audioExportError: errorMessage(error),
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
      get().notify(`取消失败：${errorMessage(error)}`, 'error');
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
});
