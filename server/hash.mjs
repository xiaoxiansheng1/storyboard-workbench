import { sha1Short } from './utils/digest.mjs';

export function emptyRun() {
  return {
    status: 'idle',
    candidates: [],
    selectedId: null,
    error: null,
    signature: '',
    promptHash: '',
    progress: null,
    updatedAt: new Date().toISOString(),
  };
}

export function hashPrompt(data) {
  const raw = [
    data.promptZh || '',
    data.promptEn || '',
    data.negativeZh || '',
    data.negativeEn || '',
  ].join('\u0000');
  return sha1Short(raw);
}
