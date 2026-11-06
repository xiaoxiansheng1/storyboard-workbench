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

export interface WorkbenchConfig {
  provider: string;
  model: string;
  size: string;
  promptLang: 'en' | 'zh';
  appendNegative: boolean;
  dailyCap: number;
  usage: number;
  concurrency: number;
  hasKey: boolean;
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
