import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { probeAudio } from './video.mjs';
import { orderedAudioNodes } from './audio.mjs';
import { roundTo, clampNumber } from './utils/num.mjs';
import { fileTimestamp } from './utils/time.mjs';
import { messageOf } from './utils/message.mjs';
import { createExportRunner } from './export-runner.mjs';

const SILENCE_NOISE = '-45dB';
const SILENCE_MIN = 0.2;
const EDGE_PAD = 0.04;
const CUT_FADE = 0.008;

const PAUSE_PRESETS = {
  off: { threshold: 0, target: 0 },
  light: { threshold: 1, target: 0.4 },
  standard: { threshold: 0.6, target: 0.3 },
  tight: { threshold: 0.4, target: 0.2 },
};

function normalizeOptions(raw = {}) {
  const format = raw.format === 'wav' ? 'wav' : 'mp3';
  const gapSec = roundTo(clampNumber(raw.gapSec, 0, 2, 0), 1);
  const gainDb = roundTo(clampNumber(raw.gainDb, -12, 12, 0), 1);
  const enhance = ['off', 'level', 'voice'].includes(raw.enhance) ? raw.enhance : 'off';
  const bitrate = [128, 192, 320].includes(Number(raw.bitrate)) ? Number(raw.bitrate) : 192;
  const bits = Number(raw.bits) === 24 ? 24 : 16;
  const channels = Number(raw.channels) === 2 ? 2 : 1;

  const pauseMode = ['off', 'light', 'standard', 'tight', 'custom'].includes(raw.pauseMode)
    ? raw.pauseMode
    : 'off';
  let pauseThresholdSec = 0;
  let pauseTargetSec = 0;
  if (pauseMode !== 'off') {
    if (pauseMode === 'custom') {
      pauseThresholdSec = roundTo(clampNumber(raw.pauseThresholdSec, 0.3, 2, 0.6), 1);
      pauseTargetSec = roundTo(clampNumber(raw.pauseTargetSec, 0.1, 1, 0.3), 1);
      if (pauseTargetSec > pauseThresholdSec - 0.1) {
        pauseTargetSec = roundTo(Math.max(0.1, pauseThresholdSec - 0.1), 1);
      }
    } else {
      pauseThresholdSec = PAUSE_PRESETS[pauseMode].threshold;
      pauseTargetSec = PAUSE_PRESETS[pauseMode].target;
    }
  }

  const nodeIds = Array.isArray(raw.nodeIds)
    ? raw.nodeIds.filter((item) => typeof item === 'string' && item)
    : [];
  return {
    options: {
      format,
      gapSec,
      gainDb,
      enhance,
      bitrate,
      bits,
      channels,
      pauseMode,
      pauseThresholdSec,
      pauseTargetSec,
      allowMissing: Boolean(raw.allowMissing),
      nodeIds,
    },
  };
}

function parseSilences(stderr, duration) {
  const silences = [];
  let start = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (startMatch) {
      start = Math.max(0, Number(startMatch[1]));
      continue;
    }
    const endMatch = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (endMatch && start !== null) {
      const end = Math.min(duration, Number(endMatch[1]));
      if (end > start) silences.push({ start, end });
      start = null;
    }
  }
  if (start !== null && duration > start) silences.push({ start, end: duration });
  return silences;
}

function planSegments(duration, silences, options) {
  const threshold = options.pauseThresholdSec;
  const target = options.pauseTargetSec;
  let from = 0;
  let to = duration;
  const removes = [];

  for (const silence of silences) {
    const start = Math.max(0, silence.start);
    const end = Math.min(duration, silence.end);
    const length = end - start;
    if (length < 0.05) continue;
    if (start <= 0.08) {
      from = Math.max(from, Math.min(duration, end - EDGE_PAD));
      continue;
    }
    if (end >= duration - 0.08) {
      to = Math.min(to, Math.max(0, start + EDGE_PAD));
      continue;
    }
    if (threshold > 0 && length >= threshold && length > target) {
      removes.push([start + target / 2, end - target / 2]);
    }
  }

  if (to - from < 0.05) return [{ start: 0, end: duration }];

  const segments = [];
  let cursor = from;
  for (const [cutStart, cutEnd] of removes) {
    if (cutStart <= cursor) {
      cursor = Math.max(cursor, cutEnd);
      continue;
    }
    if (cutStart > cursor + 0.01) segments.push({ start: cursor, end: cutStart });
    cursor = Math.max(cursor, cutEnd);
  }
  if (to > cursor + 0.01) segments.push({ start: cursor, end: to });
  if (!segments.length) return [{ start: 0, end: duration }];
  return segments;
}

export function createAudioExports({
  store,
  config,
  broadcast,
  projectId,
  exportDir = path.join(config.dataDir, 'audio-exports'),
  historyFile = path.join(config.dataDir, 'audio-exports.json'),
}) {
  const {
    emit,
    finish,
    ensureAlive,
    runFfmpeg,
    isBusy,
    begin,
    cancel,
    list,
    get,
    dispose,
    isDisposed,
    label,
  } = createExportRunner({
    broadcast,
    projectId,
    type: 'audio-export',
    config,
    exportDir,
    historyFile,
    label: '音频合成任务',
  });

  function collect(options) {
    const nodes = orderedAudioNodes(store.data.nodes, store.data.edges);
    const requested = options.nodeIds.length ? new Set(options.nodeIds) : null;
    const pool = requested ? nodes.filter((node) => requested.has(node.id)) : nodes;
    if (!pool.length) {
      const error = new Error('没有可合成的音频节点');
      error.status = 400;
      throw error;
    }

    const clips = [];
    const missing = [];
    for (const node of pool) {
      const run = node.data.run;
      const candidates = Array.isArray(run?.candidates) ? run.candidates : [];
      const candidate =
        candidates.find((item) => item.id === run.selectedId) || candidates[candidates.length - 1];
      const filename = candidate?.filename || (candidate?.url ? path.basename(candidate.url) : '');
      if (!candidate || !filename) {
        missing.push({ id: node.id, no: node.data.no });
        continue;
      }
      const source = path.join(store.assetsDir, node.id, filename);
      if (!fs.existsSync(source)) {
        missing.push({ id: node.id, no: node.data.no });
        continue;
      }
      const duration = Math.max(0.05, Number(candidate.durationSec) || 0);
      clips.push({ nodeId: node.id, no: node.data.no, source, duration });
    }

    if (missing.length && !options.allowMissing) {
      const error = new Error(`有 ${missing.length} 个音频节点还没有生成`);
      error.status = 400;
      error.missing = missing;
      throw error;
    }
    if (!clips.length) {
      const error = new Error('没有可合成的音频，请先生成音频');
      error.status = 400;
      throw error;
    }
    return { clips, missing };
  }

  function analyzeSilence(run, clip) {
    return new Promise((resolve) => {
      const child = spawn(
        config.ffmpegPath,
        [
          '-hide_banner',
          '-nostats',
          '-i',
          clip.source,
          '-af',
          `silencedetect=noise=${SILENCE_NOISE}:d=${SILENCE_MIN}`,
          '-f',
          'null',
          '-',
        ],
        { windowsHide: true },
      );
      run.children.add(child);
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (stderr.length > 400000) stderr = stderr.slice(-200000);
      });
      child.on('error', () => {
        run.children.delete(child);
        resolve([]);
      });
      child.on('close', () => {
        run.children.delete(child);
        resolve(run.canceled ? [] : parseSilences(stderr, clip.duration));
      });
    });
  }

  async function process(run) {
    const { job, clips } = run;
    const options = job.options;
    const gap = options.gapSec || 0;
    const layout = options.channels === 2 ? 'stereo' : 'mono';
    const tmp = path.join(exportDir, `.tmp-audio-${job.id}`);
    let outputDuration = 0;

    try {
      ensureAlive(run);
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });

      job.status = 'running';
      job.stage = options.pauseMode === 'off' ? '准备音频' : '分析停顿';
      job.progress = 1;
      emit(job);

      for (let i = 0; i < clips.length; i += 1) {
        ensureAlive(run);
        const clip = clips[i];
        if (options.pauseMode === 'off') {
          clip.segments = [{ start: 0, end: clip.duration }];
        } else {
          const silences = await analyzeSilence(run, clip);
          clip.segments = planSegments(clip.duration, silences, options);
          job.stage = `分析停顿 ${i + 1}/${clips.length}`;
          job.progress = Math.min(12, 1 + Math.round((12 * (i + 1)) / clips.length));
          emit(job);
        }
        clip.processedDuration = clip.segments.reduce(
          (sum, segment) => sum + (segment.end - segment.start),
          0,
        );
      }

      outputDuration =
        clips.reduce((sum, clip) => sum + clip.processedDuration, 0) +
        gap * Math.max(0, clips.length - 1);
      job.durationSec = roundTo(outputDuration, 3);
      emit(job);

      const args = ['-y', '-hide_banner', '-loglevel', 'error'];
      for (const clip of clips) args.push('-i', clip.source);

      const parts = [];
      const format = `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=${layout}`;
      clips.forEach((clip, i) => {
        const source = `[${i}:a]aresample=44100,${format},asetpts=PTS-STARTPTS`;
        const segments = clip.segments;
        if (segments.length === 1) {
          const segment = segments[0];
          if (segment.start <= 0.001 && segment.end >= clip.duration - 0.001) {
            parts.push(`${source}[c${i}]`);
            return;
          }
        }
        parts.push(
          `${source},asplit=${segments.length}${segments
            .map((_, index) => `[q${i}_${index}]`)
            .join('')}`,
        );
        segments.forEach((segment, index) => {
          const length = segment.end - segment.start;
          const fade =
            length > CUT_FADE * 2
              ? `,afade=t=in:st=0:d=${CUT_FADE},afade=t=out:st=${(length - CUT_FADE).toFixed(4)}:d=${CUT_FADE}`
              : '';
          parts.push(
            `[q${i}_${index}]atrim=start=${segment.start.toFixed(4)}:end=${segment.end.toFixed(4)},asetpts=PTS-STARTPTS${fade}[s${i}_${index}]`,
          );
        });
        parts.push(
          `${segments.map((_, index) => `[s${i}_${index}]`).join('')}concat=n=${segments.length}:v=0:a=1[c${i}]`,
        );
      });

      const inputs = [];
      clips.forEach((clip, i) => {
        inputs.push(`[c${i}]`);
        if (gap > 0 && i < clips.length - 1) {
          parts.push(
            `anullsrc=r=44100:cl=${layout},atrim=duration=${gap.toFixed(3)},${format},asetpts=PTS-STARTPTS[n${i}]`,
          );
          inputs.push(`[n${i}]`);
        }
      });
      parts.push(`${inputs.join('')}concat=n=${inputs.length}:v=0:a=1[cat]`);

      const chain = [];
      if (options.enhance === 'voice') {
        chain.push(
          'highpass=f=70',
          'equalizer=f=200:t=q:w=1:g=-1.5',
          'equalizer=f=3200:t=q:w=1.2:g=2',
          'acompressor=threshold=-20dB:ratio=2.5:attack=8:release=180:knee=4',
        );
      }
      if (options.enhance !== 'off') {
        chain.push('loudnorm=I=-16:TP=-1.5:LRA=11', 'aresample=44100');
      }
      if (options.gainDb) chain.push(`volume=${options.gainDb.toFixed(1)}dB`);
      chain.push('alimiter=level_in=1:level_out=1:limit=0.95');
      parts.push(`[cat]${chain.join(',')}[out]`);

      const ext = options.format === 'wav' ? 'wav' : 'mp3';
      const filename = `audio-${fileTimestamp(new Date(job.createdAt))}-${job.id.slice(-4)}.${ext}`;
      const output = path.join(exportDir, filename);

      args.push(
        '-filter_complex',
        parts.join(';'),
        '-map',
        '[out]',
        '-ar',
        '44100',
        '-ac',
        String(options.channels),
        ...(options.format === 'wav'
          ? ['-c:a', options.bits === 24 ? 'pcm_s24le' : 'pcm_s16le']
          : ['-c:a', 'libmp3lame', '-b:a', `${options.bitrate}k`]),
        '-t',
        outputDuration.toFixed(3),
        output,
      );

      const startProgress = options.pauseMode === 'off' ? 5 : 15;
      job.stage = '正在合成音频';
      job.progress = Math.max(job.progress, startProgress);
      emit(job);

      let lastProgressAt = 0;
      await runFfmpeg(run, args, (seconds) => {
        if (!(outputDuration > 0)) return;
        const ratio = Math.max(0, Math.min(1, seconds / outputDuration));
        const value = Math.max(
          job.progress,
          Math.min(99, Math.round(startProgress + ratio * (99 - startProgress))),
        );
        if (value === job.progress) return;
        job.progress = value;
        const now = Date.now();
        if (now - lastProgressAt < 500) return;
        lastProgressAt = now;
        emit(job);
      });

      ensureAlive(run);
      let actualDuration = outputDuration;
      try {
        actualDuration = (await probeAudio(config.ffprobePath, output)).durationSec;
      } catch {
        // ffprobe 不可用时退回按片段时长计算的估值
      }
      job.status = 'done';
      job.stage = '已完成';
      job.progress = 100;
      job.url = `/exports/${projectId}/${filename}`;
      job.filename = filename;
      job.size = fs.statSync(output).size;
      job.durationSec = roundTo(actualDuration, 3);
      job.finishedAt = new Date().toISOString();
      finish(run, job);
    } catch (error) {
      job.finishedAt = new Date().toISOString();
      if (isDisposed()) return;
      if (run.canceled) {
        job.status = 'canceled';
        job.stage = '已取消';
        job.progress = 0;
        job.error = null;
      } else {
        job.status = 'error';
        job.stage = '合成失败';
        job.error = messageOf(error);
      }
      finish(run, job);
      if (!run.canceled) console.error(`[audio-export] ${job.id} 失败:`, job.error);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  function start(rawOptions) {
    if (isBusy()) {
      const error = new Error(`已有${label}正在进行`);
      error.status = 409;
      throw error;
    }
    const normalized = normalizeOptions(rawOptions);
    if (normalized.error) {
      const error = new Error(normalized.error);
      error.status = 400;
      throw error;
    }
    const options = normalized.options;
    const { clips, missing } = collect(options);
    const createdAt = new Date().toISOString();
    const job = {
      id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      status: 'queued',
      stage: '排队中',
      progress: 0,
      error: null,
      url: null,
      filename: null,
      size: null,
      durationSec:
        clips.reduce((sum, clip) => sum + clip.duration, 0) +
        (options.gapSec || 0) * Math.max(0, clips.length - 1),
      nodes: clips.length,
      missing: missing.map((item) => item.no),
      options,
      createdAt,
      finishedAt: null,
    };
    const run = { job, clips, canceled: false, children: new Set(), finished: false };
    begin(run);
    emit(job);
    void process(run);
    return job;
  }

  return { start, cancel, list, get, dispose };
}
