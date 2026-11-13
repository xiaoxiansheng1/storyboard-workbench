import type { Node } from '@xyflow/react';
import type {
  AudioData,
  AudioRun,
  Project,
  Run,
  ShotData,
  WorkbenchConfig,
  WorkbenchNodeData,
} from '../src/types';

let seq = 0;

export function makeRun(overrides: Partial<Run> = {}): Run {
  seq += 1;
  return {
    status: 'idle',
    candidates: [],
    selectedId: null,
    error: null,
    signature: `sig-${seq}`,
    promptHash: `hash-${seq}`,
    progress: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeAudioRun(overrides: Partial<AudioRun> = {}): AudioRun {
  seq += 1;
  return {
    status: 'idle',
    candidates: [],
    selectedId: null,
    error: null,
    signature: '',
    textHash: '',
    progress: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeShotData(no: number, overrides: Partial<ShotData> = {}): ShotData {
  return {
    no,
    srtStart: '00:00:00,000',
    srtEnd: '00:00:02,000',
    startSec: 0,
    endSec: 2,
    duration: 2,
    anchor: 'A',
    caption: `镜头 ${no}`,
    promptZh: '中文提示',
    promptEn: '',
    negativeZh: '',
    negativeEn: '',
    videoPrompt: '',
    promptHash: '',
    run: makeRun(),
    ...overrides,
  };
}

export function makeAudioData(no: number, overrides: Partial<AudioData> = {}): AudioData {
  return {
    no,
    text: `台词 ${no}`,
    textHash: `th-${no}`,
    run: makeAudioRun(),
    ...overrides,
  };
}

export function shotNode(
  id: string,
  no: number,
  x = 0,
  y = 0,
  overrides: Partial<ShotData> = {},
): Node<WorkbenchNodeData> {
  return { id, type: 'shot', position: { x, y }, data: makeShotData(no, overrides) };
}

export function audioNode(id: string, no: number, x = 0, y = 0): Node<WorkbenchNodeData> {
  return { id, type: 'audio', position: { x, y }, data: makeAudioData(no) };
}

export function makeConfig(usage = 0): WorkbenchConfig {
  return {
    provider: 'mock',
    providerLabel: 'Mock',
    model: 'mock-model',
    models: [],
    size: '1024x1024',
    promptLang: 'zh',
    appendNegative: true,
    dailyCap: 100,
    usage,
    concurrency: 2,
    maxBatch: 10,
    hasKey: true,
    keyHint: 'sk-***',
    audio: {
      baseUrl: '',
      inferMode: '普通推理',
      hasVoice: false,
      voiceName: null,
      voiceDurationSec: null,
      voiceUpdatedAt: null,
      voiceUrl: null,
    },
  };
}

export function makeProject(usage = 0): Project {
  return {
    meta: {
      name: '测试项目',
      sourceFile: null,
      importedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      stats: null,
    },
    nodes: [],
    edges: [],
    config: makeConfig(usage),
  };
}
