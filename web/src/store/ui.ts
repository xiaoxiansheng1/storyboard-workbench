import { toast } from 'sonner';
import { api } from '../api';
import { projectBase } from './model';
import { errorMessage } from '../utils/error';
import type { SliceCreator } from './base';

export interface UiSlice {
  importOpen: boolean;
  settingsOpen: boolean;
  exportOpen: boolean;
  batchOpen: boolean;
  batchBusy: boolean;
  taskOpen: boolean;
  focusSeq: number;
  focusTarget: string | null;
  audioAddOpen: boolean;
  audioExportOpen: boolean;
  lightbox: { nodeId: string; index: number } | null;

  setImportOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setBatchOpen: (open: boolean) => void;
  setTaskOpen: (open: boolean) => void;
  focusNode: (nodeId: string) => void;
  cancelTask: (nodeId: string) => Promise<void>;
  setAudioAddOpen: (open: boolean) => void;
  setAudioExportOpen: (open: boolean) => void;
  setLightbox: (value: { nodeId: string; index: number } | null) => void;
  notify: (message: string, tone?: 'default' | 'success' | 'error') => void;
}

export const createUiSlice: SliceCreator<UiSlice> = (set, get) => ({
  importOpen: false,
  settingsOpen: false,
  exportOpen: false,
  batchOpen: false,
  batchBusy: false,
  taskOpen: false,
  focusSeq: 0,
  focusTarget: null,
  audioAddOpen: false,
  audioExportOpen: false,
  lightbox: null,

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
      get().notify(`取消失败：${errorMessage(error)}`, 'error');
    }
  },

  setAudioAddOpen: (open) => set({ audioAddOpen: open }),

  setAudioExportOpen: (open) => {
    set({ audioExportOpen: open, audioExportError: null });
    if (open) void get().loadAudioExports();
  },

  setLightbox: (value) => set({ lightbox: value }),

  notify: (message, tone = 'default') => {
    if (!message) return;
    if (tone === 'error') toast.error(message, { duration: 6000 });
    else if (tone === 'success') toast.success(message);
    else toast(message);
  },
});
