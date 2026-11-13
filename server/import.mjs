import { emptyRun, hashPrompt } from './hash.mjs';
import { pad2, roundTo } from './utils/num.mjs';

const GRID_X = 120;
const GRID_Y = 80;
const COL_PITCH = 420;
const ROW_PITCH = 370;
const GRID_COLS_MAX = 8;

const ALIASES = {
  no: ['镜号', '镜头', '镜头号', 'shot', 'shotno', 'no'],
  start: ['srt起始', '起始', '开始', '开始时间', 'start', 'starttime'],
  end: ['srt结束', '结束', '结束时间', 'end', 'endtime'],
  duration: ['时长', '时长秒', 'duration', 'length'],
  anchor: ['锚点', 'anchor'],
  caption: ['文案', '字幕', '口播', 'caption', 'text'],
  promptZh: ['中文提示词', '首帧图像提示词中文', '提示词中文', 'promptzh', 'promptcn'],
  promptEn: ['englishprompt', '英文提示词', '首帧图像提示词english', 'prompten'],
  negativeZh: ['负面词中文', '负面提示词中文', 'negativezh', 'negativecn'],
  negativeEn: ['negativeprompt', '负面提示词', 'negativeen'],
  videoPrompt: ['视频提示词', 'videoprompt'],
};

function normHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s（）()【】[\]：:]/g, '');
}

export function toSeconds(timecode) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.:](\d{1,3})$/.exec(String(timecode).trim());
  if (!m) {
    const short = /^(\d{1,2}):(\d{1,2})\.(\d{1,3})$/.exec(String(timecode).trim());
    if (!short) return null;
    return Number(short[1]) * 60 + Number(short[2]) + Number(short[3].padEnd(3, '0')) / 1000;
  }
  const h = Number(m[1] || 0);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const ms = Number(m[4].padEnd(3, '0'));
  return h * 3600 + min * 60 + sec + ms / 1000;
}

function pick(row, index, aliases) {
  for (const alias of aliases) {
    const i = index.get(alias);
    if (i !== undefined && row[i] !== undefined) return String(row[i]).trim();
  }
  return '';
}

export function buildProject(rows, { name, sourceFile } = {}) {
  if (!rows.length) throw new Error('CSV 为空');

  const index = new Map();
  rows[0].forEach((cell, i) => {
    const key = normHeader(cell);
    if (!index.has(key)) index.set(key, i);
  });

  const hasPrompt =
    ALIASES.promptZh.some((a) => index.has(a)) || ALIASES.promptEn.some((a) => index.has(a));
  const missing = [];
  if (!ALIASES.no.some((a) => index.has(a))) missing.push('镜号');
  if (!ALIASES.start.some((a) => index.has(a))) missing.push('SRT起始');
  if (!ALIASES.end.some((a) => index.has(a))) missing.push('SRT结束');
  if (!hasPrompt) missing.push('中文提示词或 English Prompt');
  if (missing.length) {
    throw new Error(
      `CSV 缺少列：${missing.join('、')}。请用 srt-to-storyboard 的 expand_prompts.mjs 导出的 CSV。`,
    );
  }

  const warnings = [];
  const nodes = [];
  const usedIds = new Set();
  const seenNos = new Set();

  rows.slice(1).forEach((row, i) => {
    const startRaw = pick(row, index, ALIASES.start);
    const endRaw = pick(row, index, ALIASES.end);
    const startSec = toSeconds(startRaw);
    const endSec = toSeconds(endRaw);
    if (startSec === null || endSec === null) {
      warnings.push(`第 ${i + 2} 行时间码无法解析，已跳过（${startRaw} -> ${endRaw}）`);
      return;
    }
    if (endSec < startSec) warnings.push(`第 ${i + 2} 行结束时间早于开始时间，已按 +4s 处理`);

    const noText = pick(row, index, ALIASES.no).replace(/^#/, '');
    const parsedNo = Number.parseInt(noText, 10);
    const no = Number.isFinite(parsedNo) ? parsedNo : i + 1;
    if (seenNos.has(no)) warnings.push(`镜号 ${no} 重复，节点已保留但 id 加后缀`);
    seenNos.add(no);

    const durationCell = Number.parseFloat(pick(row, index, ALIASES.duration));
    const duration = Number.isFinite(durationCell)
      ? roundTo(durationCell, 2)
      : roundTo(Math.max(0, endSec - startSec), 2);
    if (Number.isFinite(durationCell) && Math.abs(durationCell - (endSec - startSec)) > 0.06) {
      warnings.push(
        `镜号 ${no} 时长列 ${durationCell}s 与时间码差 ${roundTo(endSec - startSec, 2)}s 不一致，已按时长列生成`,
      );
    }

    const promptZh = pick(row, index, ALIASES.promptZh);
    const promptEn = pick(row, index, ALIASES.promptEn);
    if (!promptZh && !promptEn) warnings.push(`镜号 ${no} 没有可用提示词`);

    const anchorCell = pick(row, index, ALIASES.anchor).toUpperCase();
    let anchor = anchorCell.includes('B') ? 'B' : anchorCell.includes('A') ? 'A' : null;
    if (!anchor) {
      anchor = /\[B\]|无人物|no people/i.test(`${promptZh} ${promptEn}`) ? 'B' : 'A';
    }

    let id = `shot-${pad2(no)}`;
    if (usedIds.has(id)) id = `${id}-${i + 1}`;
    usedIds.add(id);

    const data = {
      no,
      srtStart: startRaw,
      srtEnd: endRaw,
      startSec: roundTo(startSec, 2),
      endSec: roundTo(endSec, 2),
      duration,
      anchor,
      caption: pick(row, index, ALIASES.caption),
      promptZh,
      promptEn,
      negativeZh: pick(row, index, ALIASES.negativeZh),
      negativeEn: pick(row, index, ALIASES.negativeEn),
      videoPrompt: pick(row, index, ALIASES.videoPrompt),
    };
    data.promptHash = hashPrompt(data);
    data.run = emptyRun();

    nodes.push({
      id,
      type: 'shot',
      position: { x: GRID_X, y: GRID_Y },
      data,
    });
  });

  const ordered = [...nodes].sort((a, b) => a.data.startSec - b.data.startSec);
  const cols = Math.min(GRID_COLS_MAX, Math.max(4, Math.ceil(Math.sqrt(ordered.length * 1.4))));
  // 蛇形折行，保证相邻镜头在画布上仍然相邻
  ordered.forEach((node, i) => {
    const row = Math.floor(i / cols);
    const colInRow = i % cols;
    const col = row % 2 === 0 ? colInRow : cols - 1 - colInRow;
    node.position = {
      x: GRID_X + col * COL_PITCH,
      y: GRID_Y + row * ROW_PITCH,
    };
  });

  const edges = [];
  for (let i = 1; i < ordered.length; i += 1) {
    edges.push({
      id: `edge-${ordered[i - 1].id}-${ordered[i].id}`,
      source: ordered[i - 1].id,
      target: ordered[i].id,
      kind: 'timeline',
    });
  }

  const stats = {
    count: nodes.length,
    laneA: nodes.filter((n) => n.data.anchor === 'A').length,
    laneB: nodes.filter((n) => n.data.anchor === 'B').length,
    firstStart: ordered.length ? ordered[0].data.startSec : 0,
    lastEnd: ordered.length ? ordered[ordered.length - 1].data.endSec : 0,
    span: ordered.length
      ? roundTo(ordered[ordered.length - 1].data.endSec - ordered[0].data.startSec, 2)
      : 0,
    warnings,
  };

  return {
    nodes,
    edges,
    stats,
    meta: {
      name: name || sourceFile?.replace(/\.csv$/i, '') || '未命名分镜',
      sourceFile: sourceFile || null,
      importedAt: new Date().toISOString(),
      stats,
    },
  };
}
