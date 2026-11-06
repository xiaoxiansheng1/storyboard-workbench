import crypto from 'node:crypto';

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
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

export function round2(value) {
  return Math.round(value * 100) / 100;
}
