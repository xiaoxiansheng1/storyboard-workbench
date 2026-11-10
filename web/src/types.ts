export interface Candidate {
  id: string;
  url: string;
  filename?: string;
  seed: number | null;
  size: string;
  provider: string;
  model: string;
  promptHash: string;
  createdAt: string;
}

export type RunStatus = 'idle' | 'queued' | 'running' | 'done' | 'error';

export interface Run {
  status: RunStatus;
  candidates: Candidate[];
  selectedId: string | null;
  error: string | null;
  signature: string;
  promptHash: string;
  progress: { done: number; total: number } | null;
  updatedAt: string;
}

export interface ShotVideo {
  filename: string;
  url: string;
  posterUrl: string | null;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  inPoint: number;
  addedAt: string;
}

export interface ShotData extends Record<string, unknown> {
  no: number;
  srtStart: string;
  srtEnd: string;
  startSec: number;
  endSec: number;
  duration: number;
  anchor: 'A' | 'B';
  caption: string;
  promptZh: string;
  promptEn: string;
  negativeZh: string;
  negativeEn: string;
  videoPrompt: string;
  promptHash: string;
  run: Run;
  video?: ShotVideo | null;
}

export interface AudioCandidate {
  id: string;
  url: string;
  filename?: string;
  durationSec: number;
  peaks?: number[];
  mime: string;
  provider: string;
  model: string;
  textHash: string;
  voiceUpdatedAt?: string | null;
  createdAt: string;
}

export interface AudioRun {
  status: RunStatus;
  candidates: AudioCandidate[];
  selectedId: string | null;
  error: string | null;
  signature: string;
  textHash: string;
  progress: { done: number; total: number } | null;
  updatedAt: string;
}

export interface AudioData extends Record<string, unknown> {
  no: number;
  text: string;
  textHash: string;
  createdAt?: string;
  run: AudioRun;
}

export interface ShotNodeModel {
  id: string;
  type: 'shot';
  position: { x: number; y: number };
  data: ShotData;
}

export interface AudioNodeModel {
  id: string;
  type: 'audio';
  position: { x: number; y: number };
  data: AudioData;
}

export type ProjectNode = ShotNodeModel | AudioNodeModel;

export type WorkbenchNodeData = ShotData | AudioData;

export type AudioInferMode = '普通推理' | '批次推理';

export interface AudioSettings {
  baseUrl: string;
  inferMode: AudioInferMode;
  hasVoice: boolean;
  voiceName: string | null;
  voiceDurationSec: number | null;
  voiceUpdatedAt: string | null;
  voiceUrl: string | null;
}

export interface AudioHealth {
  ok: boolean;
  baseUrl?: string;
  title?: string;
  version?: string;
  error?: string;
}

export interface AudioSplitResponse {
  chunks: string[];
  chars: number;
}

export interface AudioImportResponse {
  project: Project;
  stats: { count: number; chars: number; sourceFile: string | null };
}

export type AudioFormat = 'mp3' | 'wav';
export type AudioEnhance = 'off' | 'level' | 'voice';
export type AudioPauseMode = 'off' | 'light' | 'standard' | 'tight' | 'custom';

export interface AudioExportOptions {
  format: AudioFormat;
  gapSec: number;
  allowMissing: boolean;
  nodeIds: string[];
  gainDb?: number;
  enhance?: AudioEnhance;
  bitrate?: number;
  bits?: number;
  channels?: 1 | 2;
  pauseMode?: AudioPauseMode;
  pauseThresholdSec?: number;
  pauseTargetSec?: number;
}

export interface AudioExportJob {
  id: string;
  status: ExportStatus;
  stage: string;
  progress: number;
  error: string | null;
  url: string | null;
  filename: string | null;
  size: number | null;
  durationSec: number;
  nodes: number;
  missing: number[];
  options: AudioExportOptions;
  createdAt: string;
  finishedAt: string | null;
}

export interface AudioExportList {
  active: AudioExportJob | null;
  jobs: AudioExportJob[];
}

export interface ProjectEdge {
  id: string;
  source: string;
  target: string;
  kind?: string;
}

export interface ImageModelOption {
  id: string;
  label: string;
  note?: string;
}

export interface WorkbenchConfig {
  provider: string;
  providerLabel: string;
  model: string;
  models: ImageModelOption[];
  size: string;
  promptLang: 'en' | 'zh';
  appendNegative: boolean;
  dailyCap: number;
  usage: number;
  concurrency: number;
  maxBatch: number;
  hasKey: boolean;
  keyHint: string;
  audio: AudioSettings;
}

export interface SystemSettings {
  provider: string;
  providerLabel: string;
  imageModel: string;
  models: ImageModelOption[];
  hasKey: boolean;
  keyHint: string;
  promptLang: 'en' | 'zh';
  size: string;
  dailyCap: number;
  usage: number;
  concurrency: number;
  maxBatch: number;
  audio: AudioSettings;
}

export interface ImportStats {
  count: number;
  laneA: number;
  laneB: number;
  firstStart: number;
  lastEnd: number;
  span: number;
  warnings: string[];
  reused?: number;
}

export interface ProjectMeta {
  name: string;
  sourceFile: string | null;
  importedAt: string | null;
  createdAt: string;
  stats: ImportStats | null;
}

export interface Project {
  meta: ProjectMeta;
  nodes: ProjectNode[];
  edges: ProjectEdge[];
  config: WorkbenchConfig;
}

export interface ProjectSummary {
  id: string;
  name: string;
  shots: number;
  generated: number;
  cover: string | null;
  sourceFile: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportResponse {
  project: Project;
  stats: ImportStats;
}

export type ExportFit = 'contain' | 'cover';
export type ExportQuality = 'standard' | 'high';
export type ExportMotion = 'none' | 'in' | 'out';
export type ExportTransition = 'none' | 'crossfade' | 'fade';

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  fit?: ExportFit;
  quality?: ExportQuality;
  motion?: ExportMotion;
  transition?: ExportTransition;
  transitionSec?: number;
  allowMissing: boolean;
}

export type ExportStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface ExportJob {
  id: string;
  status: ExportStatus;
  stage: string;
  progress: number;
  error: string | null;
  url: string | null;
  filename: string | null;
  size: number | null;
  durationSec: number;
  shots: number;
  missing: number[];
  stale: number;
  options: ExportOptions;
  createdAt: string;
  finishedAt: string | null;
}

export interface ExportList {
  active: ExportJob | null;
  jobs: ExportJob[];
}
