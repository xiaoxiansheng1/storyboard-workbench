import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const HISTORY_LIMIT = 20;

function timestamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function normalizeOptions(raw = {}) {
  const width = Math.trunc(Number(raw.width));
  const height = Math.trunc(Number(raw.height));
  const fps = Math.trunc(Number(raw.fps)) || 30;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 240 || width > 3840 || height > 2160) {
    return { error: '输出尺寸需在 320×240 到 3840×2160 之间' };
  }
  if (width % 2 || height % 2) return { error: '输出尺寸必须是偶数' };
  if (![24, 25, 30].includes(fps)) return { error: '帧率只支持 24 / 25 / 30' };
  const fit = raw.fit === undefined ? 'contain' : raw.fit;
  if (!['contain', 'cover'].includes(fit)) return { error: '画面适配只支持留黑边或裁剪填满' };
  const quality = raw.quality === undefined ? 'standard' : raw.quality;
  if (!['standard', 'high'].includes(quality)) return { error: '画质只支持标准或高清' };
  const motion = raw.motion === undefined ? 'none' : raw.motion;
  if (!['none', 'in', 'out'].includes(motion)) return { error: '运镜只支持无、推近或拉远' };
  return {
    options: { width, height, fps, fit, quality, motion, allowMissing: Boolean(raw.allowMissing) },
  };
}

function concatPath(file) {
  return file.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

export function createExports({ store, config, broadcast }) {
  const dir = config.exportDir;
  const historyFile = path.join(config.dataDir, 'exports.json');
  fs.mkdirSync(dir, { recursive: true });

  let history = loadHistory();
  let active = null;

  function loadHistory() {
    try {
      const data = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      return Array.isArray(data) ? data.slice(0, HISTORY_LIMIT) : [];
    } catch {
      return [];
    }
  }

  function saveHistory() {
    const tmp = `${historyFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(history.slice(0, HISTORY_LIMIT), null, 2), 'utf8');
    fs.renameSync(tmp, historyFile);
  }

  function finish(run, job) {
    if (run.finished) return;
    run.finished = true;
    job.finishedAt = job.finishedAt || new Date().toISOString();
    history = [job, ...history.filter((item) => item.id !== job.id)].slice(0, HISTORY_LIMIT);
    saveHistory();
    if (active === run) active = null;
    broadcast({ type: 'export', job });
  }

  function ensureAlive(run) {
    if (run.canceled) throw new Error('已取消');
  }

  function runFfmpeg(run, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(config.ffmpegPath, args, { windowsHide: true });
      run.child = child;
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-2000);
      });
      child.on('error', (error) => {
        run.child = null;
        reject(
          new Error(
            error.code === 'ENOENT'
              ? `未找到 ffmpeg（${config.ffmpegPath}），请安装后重试或设置 FFMPEG_PATH`
              : error.message,
          ),
        );
      });
      child.on('close', (code) => {
        run.child = null;
        if (run.canceled) {
          reject(new Error('已取消'));
          return;
        }
        if (code === 0) resolve();
        else reject(new Error(stderr.trim().split(/\r?\n/).slice(-4).join(' ') || `ffmpeg 退出码 ${code}`));
      });
    });
  }

  function collectShots(options) {
    const nodes = [...store.data.nodes].sort(
      (a, b) => Number(a.data.startSec) - Number(b.data.startSec) || Number(a.data.no) - Number(b.data.no),
    );
    const shots = [];
    const missing = [];
    let stale = 0;

    for (const node of nodes) {
      const data = node.data;
      const run = data.run;
      const candidate =
        run.candidates.find((item) => item.id === run.selectedId) || run.candidates[run.candidates.length - 1];
      const filename = candidate?.filename || (candidate?.url ? path.basename(candidate.url) : '');
      if (!candidate || !filename) {
        missing.push({ id: node.id, no: data.no });
        continue;
      }
      const source = path.join(store.assetsDir, node.id, filename);
      if (!fs.existsSync(source)) {
        missing.push({ id: node.id, no: data.no });
        continue;
      }
      if (run.promptHash !== data.promptHash) stale += 1;
      shots.push({
        nodeId: node.id,
        no: data.no,
        source,
        duration: Math.max(0.5, Number(data.duration) || 1),
      });
    }

    if (missing.length && !options.allowMissing) {
      const error = new Error(`有 ${missing.length} 个镜头还没有首帧`);
      error.status = 400;
      error.missing = missing;
      throw error;
    }
    if (!shots.length) {
      const error = new Error('没有可合成的镜头，请先生成首帧');
      error.status = 400;
      throw error;
    }
    return { shots, missing, stale };
  }

  async function process(run) {
    const { job, shots } = run;
    const options = job.options;
    const crf = options.quality === 'high' ? '16' : '20';
    const withMotion = options.motion === 'in' || options.motion === 'out';
    const canvasWidth = withMotion ? options.width * 2 : options.width;
    const canvasHeight = withMotion ? options.height * 2 : options.height;
    const fitFilter =
      options.fit === 'cover'
        ? `scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=increase,crop=${canvasWidth}:${canvasHeight}`
        : `scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease,pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2:color=black`;
    const buildFilter = (duration) => {
      if (!withMotion) return `${fitFilter},setsar=1,format=yuv420p`;
      const frames = Math.max(2, Math.round(duration * options.fps));
      const zoom =
        options.motion === 'in'
          ? `1+0.05*on/${frames - 1}`
          : `1.05-0.05*on/${frames - 1}`;
      return `${fitFilter},zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${options.width}x${options.height}:fps=${options.fps},setsar=1,format=yuv420p`;
    };
    const inputFlags = withMotion ? [] : ['-loop', '1'];
    const tmp = path.join(dir, `.tmp-${job.id}`);
    try {
      ensureAlive(run);
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });

      job.status = 'running';
      job.stage = '准备素材';
      job.progress = 1;
      broadcast({ type: 'export', job });

      const list = [];
      for (let i = 0; i < shots.length; i += 1) {
        ensureAlive(run);
        const shot = shots[i];
        const clip = path.join(tmp, `clip-${String(i + 1).padStart(3, '0')}.mp4`);
        job.stage = `正在渲染 ${i + 1}/${shots.length}`;
        job.progress = Math.round((i / shots.length) * 90) + 1;
        broadcast({ type: 'export', job });

        await runFfmpeg(run, [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          ...inputFlags,
          '-framerate',
          String(options.fps),
          '-i',
          shot.source,
          '-t',
          shot.duration.toFixed(3),
          '-vf',
          buildFilter(shot.duration),
          '-r',
          String(options.fps),
          '-fps_mode',
          'cfr',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          crf,
          '-pix_fmt',
          'yuv420p',
          '-an',
          clip,
        ]);
        list.push(`file '${concatPath(clip)}'`);
        job.progress = Math.round(((i + 1) / shots.length) * 90);
        broadcast({ type: 'export', job });
      }

      ensureAlive(run);
      job.stage = '正在拼接';
      job.progress = 92;
      broadcast({ type: 'export', job });

      const listFile = path.join(tmp, 'list.txt');
      fs.writeFileSync(listFile, `${list.join('\n')}\n`, 'utf8');
      const filename = `storyboard-${timestamp(new Date(job.createdAt))}-${job.id.slice(-4)}.mp4`;
      const output = path.join(dir, filename);
      await runFfmpeg(run, [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        output,
      ]);

      job.status = 'done';
      job.stage = '已完成';
      job.progress = 100;
      job.url = `/exports/${filename}`;
      job.filename = filename;
      job.size = fs.statSync(output).size;
      job.finishedAt = new Date().toISOString();
      finish(run, job);
    } catch (error) {
      job.finishedAt = new Date().toISOString();
      if (run.canceled) {
        job.status = 'canceled';
        job.stage = '已取消';
        job.progress = 0;
        job.error = null;
      } else {
        job.status = 'error';
        job.stage = '合成失败';
        job.error = error?.message || String(error);
      }
      finish(run, job);
      if (!run.canceled) console.error(`[export] ${job.id} 失败:`, job.error);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  function start(rawOptions) {
    if (active) {
      const error = new Error('已有合成任务正在进行');
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
    const { shots, missing, stale } = collectShots(options);
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
      durationSec: shots.reduce((sum, shot) => sum + shot.duration, 0),
      shots: shots.length,
      missing: missing.map((item) => item.no),
      stale,
      options,
      createdAt,
      finishedAt: null,
    };
    const run = { job, shots, canceled: false, child: null, finished: false };
    active = run;
    broadcast({ type: 'export', job });
    void process(run);
    return job;
  }

  function cancel(id) {
    if (!active || active.job.id !== id) {
      const error = new Error('没有正在运行的合成任务');
      error.status = 404;
      throw error;
    }
    if (active.job.status === 'done' || active.job.status === 'error') {
      const error = new Error('任务已结束');
      error.status = 409;
      throw error;
    }
    active.canceled = true;
    active.job.status = 'canceled';
    active.job.stage = '已取消';
    active.job.finishedAt = new Date().toISOString();
    broadcast({ type: 'export', job: active.job });
    if (active.child) active.child.kill('SIGKILL');
    return active.job;
  }

  function list() {
    return { active: active ? active.job : null, jobs: history };
  }

  function get(id) {
    if (active && active.job.id === id) return active.job;
    return history.find((item) => item.id === id) || null;
  }

  return { start, cancel, list, get };
}
