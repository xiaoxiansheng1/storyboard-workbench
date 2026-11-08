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
  const transition = raw.transition === undefined ? 'none' : raw.transition;
  if (!['none', 'crossfade', 'fade'].includes(transition)) {
    return { error: '镜头过渡只支持无、叠化或黑场' };
  }
  const transitionSec = raw.transitionSec === undefined ? 0.3 : Number(raw.transitionSec);
  if (!Number.isFinite(transitionSec) || transitionSec < 0.2 || transitionSec > 0.5) {
    return { error: '过渡时长需在 0.2–0.5 秒之间' };
  }
  return {
    options: {
      width,
      height,
      fps,
      fit,
      quality,
      motion,
      transition,
      transitionSec: Math.round(transitionSec * 10) / 10,
      allowMissing: Boolean(raw.allowMissing),
    },
  };
}

function concatPath(file) {
  return file.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

export function createExports({
  store,
  config,
  broadcast,
  projectId,
  exportDir = config.exportDir,
  historyFile = path.join(config.dataDir, 'exports.json'),
}) {
  const dir = exportDir;
  fs.mkdirSync(dir, { recursive: true });

  let history = loadHistory();
  let active = null;
  let disposed = false;

  function emit(job) {
    if (disposed) return;
    broadcast({ type: 'export', projectId, job });
  }

  function loadHistory() {
    try {
      const data = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      return Array.isArray(data) ? data.slice(0, HISTORY_LIMIT) : [];
    } catch {
      return [];
    }
  }

  function saveHistory() {
    if (disposed) return;
    const tmp = `${historyFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(history.slice(0, HISTORY_LIMIT), null, 2), 'utf8');
    fs.renameSync(tmp, historyFile);
  }

  function finish(run, job) {
    if (run.finished) return;
    run.finished = true;
    job.finishedAt = job.finishedAt || new Date().toISOString();
    if (active === run) active = null;
    if (disposed) return;
    history = [job, ...history.filter((item) => item.id !== job.id)].slice(0, HISTORY_LIMIT);
    saveHistory();
    emit(job);
  }

  function ensureAlive(run) {
    if (disposed) throw new Error('项目已删除');
    if (run.canceled) throw new Error('已取消');
  }

  function runFfmpeg(run, args, onProgress) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        config.ffmpegPath,
        onProgress ? ['-progress', 'pipe:1', '-nostats', ...args] : args,
        { windowsHide: true },
      );
      run.child = child;
      let stderr = '';
      let stdout = '';
      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-2000);
      });
      if (onProgress) {
        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
          let index = stdout.indexOf('\n');
          while (index >= 0) {
            const line = stdout.slice(0, index).trim();
            stdout = stdout.slice(index + 1);
            const match = /^out_time_us=(\d+)$/.exec(line);
            if (match) onProgress(Number(match[1]) / 1_000_000);
            index = stdout.indexOf('\n');
          }
        });
      }
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
    const nodes = store.data.nodes
      .filter((node) => node.type !== 'audio')
      .sort(
        (a, b) =>
          Number(a.data.startSec) - Number(b.data.startSec) ||
          Number(a.data.no) - Number(b.data.no),
      );
    const shots = [];
    const missing = [];
    let stale = 0;

    for (const node of nodes) {
      const data = node.data;
      const run = data.run || {};
      const duration = Math.max(0.5, Number(data.duration) || 1);
      const video = data.video;
      if (video?.filename) {
        const videoSource = path.join(store.assetsDir, node.id, video.filename);
        if (fs.existsSync(videoSource)) {
          shots.push({
            nodeId: node.id,
            no: data.no,
            source: videoSource,
            duration,
            kind: 'video',
            inPoint: Math.max(0, Number(video.inPoint) || 0),
            videoDuration: Math.max(0, Number(video.durationSec) || 0),
          });
          continue;
        }
      }

      const candidates = Array.isArray(run.candidates) ? run.candidates : [];
      const candidate =
        candidates.find((item) => item.id === run.selectedId) || candidates[candidates.length - 1];
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
        duration,
        kind: 'image',
        inPoint: 0,
        videoDuration: 0,
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
    const transition = options.transition || 'none';
    const transSec = options.transitionSec || 0.3;
    const crossfade = transition === 'crossfade' && shots.length > 1;
    const headHandle = (index) => (crossfade && index > 0 ? transSec / 2 : 0);
    const tailHandle = (index) => (crossfade && index < shots.length - 1 ? transSec / 2 : 0);
    const clipDuration = (index) => shots[index].duration + headHandle(index) + tailHandle(index);
    // zoompan 的裁剪偏移按整数像素取整，画布越接近输出抖动越明显；
    // 超采样到输出的 2–4 倍并把画布控制在约 33MP 内，可把取整误差压到 1/4–1/2 像素
    const motionScale = withMotion
      ? Math.max(2, Math.min(4, Math.floor(Math.sqrt(33_177_600 / (options.width * options.height)))))
      : 1;
    const canvasWidth = options.width * motionScale;
    const canvasHeight = options.height * motionScale;
    const fitFilter =
      options.fit === 'cover'
        ? `scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=increase,crop=${canvasWidth}:${canvasHeight}`
        : `scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease,pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2:color=black`;
    const videoFitFilter =
      options.fit === 'cover'
        ? `scale=${options.width}:${options.height}:force_original_aspect_ratio=increase,crop=${options.width}:${options.height}`
        : `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2:color=black`;

    const fadeParts = (duration, index) => {
      if (transition !== 'fade') return [];
      const fade = Math.min(transSec / 2, duration / 2);
      if (fade <= 0.001) return [];
      const parts = [];
      if (index > 0) parts.push(`fade=t=in:st=0:d=${fade.toFixed(3)}`);
      if (index < shots.length - 1) {
        parts.push(`fade=t=out:st=${Math.max(0, duration - fade).toFixed(3)}:d=${fade.toFixed(3)}`);
      }
      return parts;
    };

    const buildImageFilter = (duration, index) => {
      const parts = [];
      if (!withMotion) {
        parts.push(fitFilter);
      } else {
        const frames = Math.max(2, Math.round(duration * options.fps));
        const zoom =
          options.motion === 'in'
            ? `1+0.05*on/${frames - 1}`
            : `1.05-0.05*on/${frames - 1}`;
        // zoompan 自带的缩小内核在逐帧取整时会闪动，先输出更大的画面，再用 lanczos 一次性缩到目标尺寸；
        // 4K 输出若同样用 2 倍中间帧会非常慢，降到 1.5 倍
        const midScale = options.width * options.height > 4_000_000 ? 1.5 : 2;
        const midWidth = Math.round((options.width * midScale) / 2) * 2;
        const midHeight = Math.round((options.height * midScale) / 2) * 2;
        parts.push(
          fitFilter,
          `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${midWidth}x${midHeight}:fps=${options.fps}`,
          `scale=${options.width}:${options.height}:flags=lanczos`,
        );
      }
      parts.push('setsar=1', ...fadeParts(duration, index), 'format=yuv420p');
      return parts.join(',');
    };

    const buildVideoShot = (shot, index) => {
      const slot = shot.duration;
      const head = headHandle(index);
      const tail = tailHandle(index);
      const inPoint = Math.min(Math.max(0, shot.inPoint), Math.max(0, shot.videoDuration - 0.05));
      const available = Math.max(0, shot.videoDuration - inPoint);
      let take = slot;
      let speed = 1;
      let freeze = 0;
      if (available <= 0.05) {
        take = Math.min(slot, 0.05);
        freeze = slot - take;
      } else if (available >= slot - 0.01) {
        take = slot;
      } else if (available >= slot * 0.9) {
        // 只差一点点时轻微放慢补齐，避免出现明显定格
        take = available;
        speed = available / slot;
      } else {
        take = available;
        freeze = slot - available;
      }
      const parts = [];
      if (speed < 0.999) parts.push(`setpts=(PTS-STARTPTS)*${(1 / speed).toFixed(6)}`);
      else parts.push('setpts=PTS-STARTPTS');
      parts.push(`fps=${options.fps}`, videoFitFilter);
      if (head > 0.001) parts.push(`tpad=start_mode=clone:start_duration=${head.toFixed(3)}`);
      const stop = freeze + tail;
      if (stop > 0.001) parts.push(`tpad=stop_mode=clone:stop_duration=${stop.toFixed(3)}`);
      parts.push('setsar=1', ...fadeParts(slot, index), 'format=yuv420p');
      return {
        filter: parts.join(','),
        inPoint,
        take: Math.max(0.05, take),
        duration: slot + head + tail,
      };
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
      emit(job);

      let lastProgressAt = 0;
      const report = (seconds, total, start, end) => {
        if (!(total > 0)) return;
        const ratio = Math.max(0, Math.min(1, seconds / total));
        const value = Math.max(job.progress, Math.min(99, Math.round(start + ratio * (end - start))));
        if (value === job.progress) return;
        job.progress = value;
        const now = Date.now();
        if (now - lastProgressAt < 500) return;
        lastProgressAt = now;
        emit(job);
      };

      const list = [];
      const clips = [];
      for (let i = 0; i < shots.length; i += 1) {
        ensureAlive(run);
        const shot = shots[i];
        const clip = path.join(tmp, `clip-${String(i + 1).padStart(3, '0')}.mp4`);
        const shotStart = Math.round((i / shots.length) * 90) + 1;
        const shotEnd = Math.round(((i + 1) / shots.length) * 90);
        job.stage = `正在渲染 ${i + 1}/${shots.length}`;
        job.progress = shotStart;
        emit(job);

        const common = [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
        ];
        let args;
        let clipSeconds;
        if (shot.kind === 'video') {
          const built = buildVideoShot(shot, i);
          clipSeconds = built.duration;
          args = [
            ...common,
            '-ss',
            built.inPoint.toFixed(3),
            '-t',
            built.take.toFixed(3),
            '-i',
            shot.source,
            '-t',
            built.duration.toFixed(3),
            '-vf',
            built.filter,
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
          ];
        } else {
          const duration = clipDuration(i);
          clipSeconds = duration;
          let source = shot.source;
          if (withMotion && /\.png$/i.test(source)) {
            // 运镜时 ffmpeg 会反复解码原图；先转成高质量 JPEG，可让单镜渲染快约一倍
            const converted = path.join(tmp, `base-${String(i + 1).padStart(3, '0')}.jpg`);
            try {
              await runFfmpeg(run, [
                ...common,
                '-i',
                source,
                '-frames:v',
                '1',
                '-vf',
                'format=rgb24',
                '-q:v',
                '2',
                converted,
              ]);
              source = converted;
            } catch (error) {
              if (run.canceled) throw error;
            }
          }
          args = [
            ...common,
            ...inputFlags,
            '-framerate',
            String(options.fps),
            '-i',
            source,
            '-t',
            duration.toFixed(3),
            '-vf',
            buildImageFilter(duration, i),
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
          ];
        }
        await runFfmpeg(run, args, (seconds) => report(seconds, clipSeconds, shotStart, shotEnd));
        clips.push(clip);
        list.push(`file '${concatPath(clip)}'`);
        job.progress = Math.round(((i + 1) / shots.length) * 90);
        emit(job);
      }

      ensureAlive(run);
      const filename = `storyboard-${timestamp(new Date(job.createdAt))}-${job.id.slice(-4)}.mp4`;
      const output = path.join(dir, filename);

      if (crossfade) {
        job.stage = '正在应用叠化';
        job.progress = 92;
        emit(job);

        const outputDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
        const args = ['-y', '-hide_banner', '-loglevel', 'error'];
        for (const clip of clips) args.push('-i', clip);
        const chain = clips.map(
          (_, i) => `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[c${i}]`,
        );
        let last = 'c0';
        let boundary = shots[0].duration;
        for (let i = 1; i < clips.length; i += 1) {
          const offset = Math.max(0, boundary - transSec / 2);
          const out = i === clips.length - 1 ? 'vout' : `x${i}`;
          chain.push(
            `[${last}][c${i}]xfade=transition=fade:duration=${transSec.toFixed(3)}:offset=${offset.toFixed(3)}[${out}]`,
          );
          last = out;
          boundary += shots[i].duration;
        }
        args.push(
          '-filter_complex',
          chain.join(';'),
          '-map',
          `[${last}]`,
          '-t',
          outputDuration.toFixed(3),
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
          '-movflags',
          '+faststart',
          output,
        );
        await runFfmpeg(run, args, (seconds) => report(seconds, outputDuration, 92, 99));
      } else {
        job.stage = '正在拼接';
        job.progress = 92;
        emit(job);

        const listFile = path.join(tmp, 'list.txt');
        fs.writeFileSync(listFile, `${list.join('\n')}\n`, 'utf8');
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
      }

      job.status = 'done';
      job.stage = '已完成';
      job.progress = 100;
      job.url = `/exports/${projectId}/${filename}`;
      job.filename = filename;
      job.size = fs.statSync(output).size;
      job.finishedAt = new Date().toISOString();
      finish(run, job);
    } catch (error) {
      job.finishedAt = new Date().toISOString();
      if (disposed) return;
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
    emit(job);
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
    emit(active.job);
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

  function dispose() {
    disposed = true;
    if (active?.child) active.child.kill('SIGKILL');
    active = null;
  }

  return { start, cancel, list, get, dispose };
}
