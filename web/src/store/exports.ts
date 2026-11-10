import { api } from '../api';
import type { ExportJob, ExportList, ExportOptions } from '../types';
import { projectBase } from './model';
import { errorMessage, errorPayload } from '../utils/error';
import type { SliceCreator } from './base';

export interface ExportsSlice {
  exportJob: ExportJob | null;
  exportHistory: ExportJob[];
  exportMissing: number[];
  exportError: string | null;
  exportStarting: boolean;

  loadExports: () => Promise<void>;
  startExport: (options: ExportOptions) => Promise<void>;
  cancelExport: (id: string) => Promise<void>;
  viewExport: (job: ExportJob | null) => void;
  applyExport: (job: ExportJob) => void;
}

export const createExportsSlice: SliceCreator<ExportsSlice> = (set, get) => ({
  exportJob: null,
  exportHistory: [],
  exportMissing: [],
  exportError: null,
  exportStarting: false,

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
      get().notify(`读取合成记录失败：${errorMessage(error)}`, 'error');
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
      const payload = errorPayload<{ missing?: { no: number }[] }>(error);
      set({
        exportError: errorMessage(error),
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
      get().notify(`取消失败：${errorMessage(error)}`, 'error');
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
});
