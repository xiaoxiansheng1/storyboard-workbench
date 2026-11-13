import fs from 'node:fs';
import { spawn } from 'node:child_process';

const HISTORY_LIMIT = 20;

// exports 与 audio-exports 共用的合成任务底座：
// 历史记录读写、SSE 广播、finish/ensureAlive、ffmpeg 子进程管理、
// 取消/列表/清理逻辑完全一致；normalizeOptions/collect/process/start 由各自模块实现
export function createExportRunner({
  broadcast,
  projectId,
  type,
  config,
  exportDir,
  historyFile,
  label,
}) {
  fs.mkdirSync(exportDir, { recursive: true });

  let history = loadHistory();
  let active = null;
  let disposed = false;

  function emit(job) {
    if (disposed) return;
    broadcast({ type, projectId, job });
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
      run.children.add(child);
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
        run.children.delete(child);
        reject(
          new Error(
            error.code === 'ENOENT'
              ? `未找到 ffmpeg（${config.ffmpegPath}），请安装后重试或设置 FFMPEG_PATH`
              : error.message,
          ),
        );
      });
      child.on('close', (code) => {
        run.children.delete(child);
        if (run.canceled) {
          reject(new Error('已取消'));
          return;
        }
        if (code === 0) resolve();
        else
          reject(
            new Error(stderr.trim().split(/\r?\n/).slice(-4).join(' ') || `ffmpeg 退出码 ${code}`),
          );
      });
    });
  }

  function killChildren(run) {
    for (const child of run.children) child.kill('SIGKILL');
  }

  function cancel(id) {
    if (!active || active.job.id !== id) {
      const error = new Error(`没有正在运行的${label}`);
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
    killChildren(active);
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
    if (active) {
      active.canceled = true;
      killChildren(active);
    }
    active = null;
  }

  return {
    emit,
    finish,
    ensureAlive,
    runFfmpeg,
    killChildren,
    isBusy: () => active !== null,
    begin: (run) => {
      active = run;
    },
    cancel,
    list,
    get,
    dispose,
    isDisposed: () => disposed,
    label,
  };
}
