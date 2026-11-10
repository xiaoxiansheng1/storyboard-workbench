import { create } from 'zustand';
import { createAudioExportsSlice } from './audioExports';
import { createAudioSlice } from './audio';
import { createCanvasSlice } from './canvas';
import { createExportsSlice } from './exports';
import { createProjectSlice } from './project';
import { createSettingsSlice } from './settings';
import { createShotsSlice } from './shots';
import { createThemeSlice } from './theme';
import { createUiSlice } from './ui';
import type { WorkbenchStore } from './base';

export type { WorkbenchStore } from './base';
export type { Theme } from './theme';

export const useWorkbench = create<WorkbenchStore>()((...slice) => ({
  ...createThemeSlice(...slice),
  ...createProjectSlice(...slice),
  ...createCanvasSlice(...slice),
  ...createUiSlice(...slice),
  ...createShotsSlice(...slice),
  ...createAudioSlice(...slice),
  ...createExportsSlice(...slice),
  ...createAudioExportsSlice(...slice),
  ...createSettingsSlice(...slice),
}));
