import { newId } from './utils/id.mjs';
import { sha1Short } from './utils/digest.mjs';
import { roundTo } from './utils/num.mjs';

const CHUNK_MIN = 20;
const CHUNK_MAX = 500;
const CHUNK_DEFAULT = 80;
const SENTENCE_END = /[。！？!?；;…]/;

export function hashAudio(text) {
  return sha1Short(text || '');
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
  return newId('audio');
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

const byAudioNo = (a, b) =>
  (Number(a.data?.no) || 0) - (Number(b.data?.no) || 0) || String(a.id).localeCompare(String(b.id));

// 音频拼接顺序由画布线决定：沿每个链头一路走到尾，未接线的节点按序号补在后面
export function orderedAudioNodes(nodes, edges = []) {
  const audio = nodes.filter((node) => node.type === 'audio');
  const byId = new Map(audio.map((node) => [node.id, node]));
  const next = new Map();
  const incoming = new Set();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    if (edge.source === edge.target || next.has(edge.source) || incoming.has(edge.target)) continue;
    next.set(edge.source, edge.target);
    incoming.add(edge.target);
  }

  const ordered = [];
  const seen = new Set();
  const walk = (start) => {
    let node = start;
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      ordered.push(node);
      node = byId.get(next.get(node.id));
    }
  };

  audio
    .filter((node) => !incoming.has(node.id))
    .sort(byAudioNo)
    .forEach(walk);
  audio
    .filter((node) => !seen.has(node.id))
    .sort(byAudioNo)
    .forEach(walk);
  return ordered;
}

// 新建音频时接在链尾，保证画布连线始终能表达完整顺序
export function audioTailEdges(prev, nodes) {
  const edges = [];
  let source = prev?.id || null;
  for (const node of nodes) {
    if (source) {
      edges.push({ id: `audio-edge-${source}-${node.id}`, source, target: node.id, kind: 'audio' });
    }
    source = node.id;
  }
  return edges;
}

export function audioChainEdges(nodes) {
  const ordered = [...nodes].filter((node) => node.type === 'audio').sort(byAudioNo);
  const edges = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const source = ordered[i - 1].id;
    const target = ordered[i].id;
    edges.push({ id: `audio-edge-${source}-${target}`, source, target, kind: 'audio' });
  }
  return edges;
}

// 老项目只有序号，没有音频连线：首次打开时按序号补成一条链
export function ensureAudioLinks(store) {
  const audio = store.data.nodes.filter((node) => node.type === 'audio');
  if (audio.length < 2) return false;
  const ids = new Set(audio.map((node) => node.id));
  if (store.data.edges.some((edge) => ids.has(edge.source) && ids.has(edge.target))) return false;
  store.data.edges.push(...audioChainEdges(audio));
  store.save();
  return true;
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
      if (
        /^\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3}/.test(
          value,
        )
      )
        return false;
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
  const text = stripSubtitle(raw)
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!text) return [];
  const limit = Math.max(
    CHUNK_MIN,
    Math.min(CHUNK_MAX, Math.trunc(Number(chunkChars)) || CHUNK_DEFAULT),
  );

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
  return roundTo(Math.max(0, Number(value) || 0), 3);
}
