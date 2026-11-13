import { spawn } from 'node:child_process';
import { roundTo } from './utils/num.mjs';

function runTool(bin, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          error.code === 'ENOENT'
            ? `未找到 ${bin}，请安装 ffmpeg 后重试或设置 FFMPEG_PATH / FFPROBE_PATH`
            : error.message,
        ),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error('读取视频信息超时'));
        return;
      }
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(stderr.trim().split(/\r?\n/).slice(-3).join(' ') || `${bin} 退出码 ${code}`),
      );
    });
  });
}

export async function probeVideo(ffprobePath, file) {
  const stdout = await runTool(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,avg_frame_rate,duration',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    file,
  ]);
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error('无法读取视频信息');
  }
  const stream = data.streams?.[0];
  if (!stream) throw new Error('文件里没有视频轨道');
  const duration = Number(stream.duration) || Number(data.format?.duration) || 0;
  if (!(duration > 0.1)) throw new Error('视频时长太短或无法读取');
  const ratio = String(stream.avg_frame_rate || '');
  const [num, den] = ratio.split('/').map(Number);
  const fps = den ? num / den : Number(ratio) || 0;
  return {
    durationSec: duration,
    width: Math.max(0, Math.trunc(Number(stream.width) || 0)),
    height: Math.max(0, Math.trunc(Number(stream.height) || 0)),
    fps: Number.isFinite(fps) ? fps : 0,
  };
}

export async function probeAudio(ffprobePath, file) {
  const stdout = await runTool(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,duration,sample_rate,channels',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    file,
  ]);
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error('无法读取音频信息');
  }
  const stream = data.streams?.[0];
  if (!stream) throw new Error('文件里没有音频轨道');
  const duration = Number(stream.duration) || Number(data.format?.duration) || 0;
  if (!(duration > 0.05)) throw new Error('音频时长太短或无法读取');
  return {
    durationSec: duration,
    codec: stream.codec_name || '',
    sampleRate: Number(stream.sample_rate) || 0,
    channels: Number(stream.channels) || 0,
  };
}

export function audioPeaks(ffmpegPath, file, count = 180) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'],
      { windowsHide: true },
    );
    const chunks = [];
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 60000);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-1000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          error.code === 'ENOENT'
            ? `未找到 ${ffmpegPath}，请安装 ffmpeg 后重试或设置 FFMPEG_PATH`
            : error.message,
        ),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error('读取音频波形超时'));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffmpeg 退出码 ${code}`));
        return;
      }
      const buffer = Buffer.concat(chunks);
      const total = Math.floor(buffer.length / 2);
      if (!total) {
        resolve([]);
        return;
      }
      const bucket = Math.max(1, Math.floor(total / count));
      const raw = [];
      let max = 0;
      for (let index = 0; index < count; index += 1) {
        const start = index * bucket;
        const end = Math.min(total, start + bucket);
        let sum = 0;
        for (let i = start; i < end; i += 1) {
          const value = buffer.readInt16LE(i * 2) / 32768;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / Math.max(1, end - start));
        raw.push(rms);
        if (rms > max) max = rms;
      }
      resolve(max ? raw.map((value) => roundTo(Math.pow(value / max, 0.6), 3)) : []);
    });
  });
}

export async function extractPoster(ffmpegPath, file, output, atSec) {
  await runTool(
    ffmpegPath,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      Math.max(0, atSec).toFixed(3),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      '-q:v',
      '4',
      '-f',
      'image2',
      output,
    ],
    60000,
  );
}
