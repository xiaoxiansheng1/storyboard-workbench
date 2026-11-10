import type { StateCreator } from 'zustand';
import type { AudioExportsSlice } from './audioExports';
import type { AudioSlice } from './audio';
import type { CanvasSlice } from './canvas';
import type { ExportsSlice } from './exports';
import type { ProjectSlice } from './project';
import type { SettingsSlice } from './settings';
import type { ShotsSlice } from './shots';
import type { ThemeSlice } from './theme';
import type { UiSlice } from './ui';

export type WorkbenchStore = ThemeSlice &
  ProjectSlice &
  CanvasSlice &
  UiSlice &
  ShotsSlice &
  AudioSlice &
  ExportsSlice &
  AudioExportsSlice &
  SettingsSlice;

export type SliceCreator<T> = StateCreator<WorkbenchStore, [], [], T>;
