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
}

export interface ProjectNode {
  id: string;
  type: 'shot';
  position: { x: number; y: number };
  data: ShotData;
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

export interface ImportResponse {
  project: Project;
  stats: ImportStats;
}

export type ExportFit = 'contain' | 'cover';
export type ExportQuality = 'standard' | 'high';
export type ExportMotion = 'none' | 'in' | 'out';

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  fit?: ExportFit;
  quality?: ExportQuality;
  motion?: ExportMotion;
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
