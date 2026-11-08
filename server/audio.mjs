import crypto from 'node:crypto';

const CHUNK_MIN = 20;
const CHUNK_MAX = 500;
const CHUNK_DEFAULT = 80;
const SENTENCE_END = /[。！？!?；;…]/;

export function hashAudio(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 12);
}

export function emptyAudioRun() {
  return {
    status: 'idle',
    candidates: [],
    selectedId: null,
    error: null,
    signature: '',
    textHash: '',
    progress: null,
    updatedAt: new Date().toISOString(),
  };
}

export function audioNodeId() {
  return `audio-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

export function normalizeAudioData(data = {}) {
  data.text = typeof data.text === 'string' ? data.text : '';
  data.textHash = data.textHash || hashAudio(data.text);
  data.no = Number.isFinite(Number(data.no)) ? Math.max(1, Math.trunc(Number(data.no))) : 1;
  data.run = { ...emptyAudioRun(), ...(data.run || {}) };
  if (!Array.isArray(data.run.candidates)) data.run.candidates = [];
  return data;
}

export function createAudioNode({ no, text, position }) {
  return {
    id: audioNodeId(),
    type: 'audio',
    position,
    data: normalizeAudioData({
      no,
      text,
      textHash: hashAudio(text),
      createdAt: new Date().toISOString(),
      run: emptyAudioRun(),
    }),
  };
}

// 音频节点统一排在镜头下方，与镜头画布互不干扰
export function audioLane(nodes) {
  const shots = nodes.filter((node) => node.type !== 'audio');
  if (!shots.length) return 80;
  let bottom = 0;
  for (const node of shots) {
    const top = Number(node.position?.y) || 0;
    if (top > bottom) bottom = top;
  }
  return bottom + 370;
}

export function firstFreeAudioPosition(taken, lane) {
  const cols = 6;
  for (let row = 0; row < 100; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const position = { x: 120 + col * 380, y: lane + row * 250 };
      const clash = taken.some(
        (item) => Math.abs(item.x - position.x) < 340 && Math.abs(item.y - position.y) < 160,
      );
      if (!clash) return position;
    }
  }
  return { x: 120, y: lane };
}

export function audioPosition(nodes) {
  const lane = audioLane(nodes);
  const taken = nodes
    .filter((node) => node.type === 'audio')
    .map((node) => ({ x: Number(node.position?.x) || 0, y: Number(node.position?.y) || 0 }));
  return firstFreeAudioPosition(taken, lane);
}

export function nextAudioNo(nodes) {
  let max = 0;
  for (const node of nodes) {
    if (node.type !== 'audio') continue;
    max = Math.max(max, Number(node.data?.no) || 0);
  }
  return max + 1;
}

export function renumberAudio(nodes) {
  const ordered = nodes
    .filter((node) => node.type === 'audio')
    .sort((a, b) => Number(a.data.no) - Number(b.data.no));
  ordered.forEach((node, index) => {
    node.data.no = index + 1;
  });
  return ordered;
}

function stripSubtitle(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n');
  if (!/-->/.test(text)) return text;
  return text
    .split('\n')
    .filter((line) => {
      const value = line.trim();
      if (!value) return false;
      if (/^WEBVTT/i.test(value)) return false;
      if (/^\d+$/.test(value)) return false;
      if (/^\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3}/.test(value)) return false;
      return true;
    })
    .map((line) => line.replace(/<[^>]+>/g, '').replace(/\{\\[^}]+\}/g, ''))
    .join('\n');
}

function splitLong(piece, limit) {
  if (piece.length <= limit) return [piece];
  const parts = piece.split(/(?<=[，,、：:])/);
  const chunks = [];
  let current = '';
  for (const part of parts) {
    if (current && current.length + part.length > limit) {
      chunks.push(current);
      current = '';
    }
    if (part.length > limit) {
      const chars = Array.from(part);
      while (chars.length) {
        chunks.push(chars.splice(0, limit).join(''));
      }
    } else {
      current += part;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((item) => item.trim());
}

export function splitAudioText(raw, chunkChars = CHUNK_DEFAULT) {
  const text = stripSubtitle(raw).replace(/[ \t]+/g, ' ').trim();
  if (!text) return [];
  const limit = Math.max(CHUNK_MIN, Math.min(CHUNK_MAX, Math.trunc(Number(chunkChars)) || CHUNK_DEFAULT));

  const sentences = [];
  let buffer = '';
  for (const char of text) {
    if (char === '\n') {
      if (buffer.trim()) sentences.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += char;
    if (SENTENCE_END.test(char)) {
      if (buffer.trim()) sentences.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer.trim()) sentences.push(buffer.trim());

  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > limit * 1.6) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(...splitLong(sentence, limit));
      continue;
    }
    if (current && current.length + sentence.length > limit) {
      chunks.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((item) => item.trim()).filter(Boolean);
}

export function mediaSeconds(value) {
  return Math.round(Math.max(0, Number(value) || 0) * 1000) / 1000;
}
