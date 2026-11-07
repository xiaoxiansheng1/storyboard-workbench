import { useEffect, useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import { useWorkbench } from '../store';
import type { ExportFit, ExportJob, ExportMotion, ExportQuality, ShotData } from '../types';
import { IconClose } from './icons';

interface ResolutionOption {
  id: '720p' | '1080p' | '4k';
  label: string;
  width: number;
  height: number;
}

const RESOLUTIONS: ResolutionOption[] = [
  { id: '720p', label: '720p', width: 1280, height: 720 },
  { id: '1080p', label: '1080p', width: 1920, height: 1080 },
  { id: '4k', label: '4K', width: 3840, height: 2160 },
];

const FPS_OPTIONS = [24, 25, 30] as const;

const FIT_OPTIONS: { value: ExportFit; label: string }[] = [
  { value: 'contain', label: '留黑边' },
  { value: 'cover', label: '裁剪填满' },
];

const QUALITY_OPTIONS: { value: ExportQuality; label: string }[] = [
  { value: 'standard', label: '标准' },
  { value: 'high', label: '高清' },
];

const MOTION_OPTIONS: { value: ExportMotion; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'in', label: '推近' },
  { value: 'out', label: '拉远' },
];

const RENDER_KEY = 'storyboard-export-render';

interface RenderPrefs {
  resolution: ResolutionOption['id'];
  fps: number;
  fit: ExportFit;
  quality: ExportQuality;
  motion: ExportMotion;
}

const DEFAULT_PREFS: RenderPrefs = {
  resolution: '1080p',
  fps: 30,
  fit: 'contain',
  quality: 'standard',
  motion: 'none',
};

function readPrefs(): RenderPrefs {
  try {
    const raw = window.localStorage.getItem(RENDER_KEY);
    if (!raw) return DEFAULT_PREFS;
    const value = JSON.parse(raw) as Partial<RenderPrefs>;
    return {
      resolution: RESOLUTIONS.some((item) => item.id === value.resolution)
        ? (value.resolution as RenderPrefs['resolution'])
        : DEFAULT_PREFS.resolution,
      fps: FPS_OPTIONS.includes(value.fps as (typeof FPS_OPTIONS)[number])
        ? (value.fps as number)
        : DEFAULT_PREFS.fps,
      fit: value.fit === 'cover' ? 'cover' : 'contain',
      quality: value.quality === 'high' ? 'high' : 'standard',
      motion: value.motion === 'in' || value.motion === 'out' ? value.motion : 'none',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: RenderPrefs) {
  try {
    window.localStorage.setItem(RENDER_KEY, JSON.stringify(prefs));
  } catch {
    // 忽略持久化失败
  }
}

function selectedCandidate(node: Node<ShotData>) {
  const run = node.data.run;
  return run.candidates.find((item) => item.id === run.selectedId) || run.candidates[run.candidates.length - 1];
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function shotLabel(no: number): string {
  return String(no).padStart(2, '0');
}

function resLabel(width: number, height: number): string {
  if (width >= 3840) return '4K';
  if (width >= 1920) return '1080p';
  if (width >= 1280) return '720p';
  return `${width}×${height}`;
}

function statusLabel(job: ExportJob): string {
  if (job.status === 'done') return '已完成';
  if (job.status === 'error') return '失败';
  if (job.status === 'canceled') return '已取消';
  return job.stage;
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="export-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'on' : undefined}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const RES_OPTIONS = RESOLUTIONS.map((item) => ({ value: item.id, label: item.label }));
const FPS_CONTROLS: { value: number; label: string }[] = FPS_OPTIONS.map((fps) => ({
  value: fps,
  label: String(fps),
}));

export function ExportDialog() {
  const open = useWorkbench((s) => s.exportOpen);
  const setOpen = useWorkbench((s) => s.setExportOpen);
  const nodes = useWorkbench((s) => s.nodes);
  const job = useWorkbench((s) => s.exportJob);
  const history = useWorkbench((s) => s.exportHistory);
  const missingFromServer = useWorkbench((s) => s.exportMissing);
  const error = useWorkbench((s) => s.exportError);
  const starting = useWorkbench((s) => s.exportStarting);
  const startExport = useWorkbench((s) => s.startExport);
  const cancelExport = useWorkbench((s) => s.cancelExport);
  const viewExport = useWorkbench((s) => s.viewExport);

  const [allowMissing, setAllowMissing] = useState(false);
  const [prefs, setPrefs] = useState(readPrefs);

  const updatePrefs = (patch: Partial<RenderPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  };

  useEffect(() => {
    if (open) setAllowMissing(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const summary = useMemo(() => {
    let duration = 0;
    let stale = 0;
    const missing: number[] = [];
    for (const node of nodes) {
      duration += Number(node.data.duration) || 0;
      const candidate = selectedCandidate(node);
      if (!candidate) {
        missing.push(node.data.no);
        continue;
      }
      if (node.data.run.promptHash !== node.data.promptHash) stale += 1;
    }
    return { duration, stale, missing };
  }, [nodes]);

  if (!open) return null;

  const resolution = RESOLUTIONS.find((item) => item.id === prefs.resolution) ?? RESOLUTIONS[1];
  const running = job?.status === 'queued' || job?.status === 'running';
  const missing = Array.from(new Set([...summary.missing, ...missingFromServer])).sort((a, b) => a - b);
  const blocked = missing.length > 0 && !allowMissing;
  const canStart = nodes.length > 0 && !blocked && !running && !starting;
  const done = job?.status === 'done' && Boolean(job.url);
  const recent = history.slice(0, 6);

  return (
    <div className="overlay" onClick={() => setOpen(false)}>
      <div className="modal export-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>合成视频</h2>
            <p className="export-sub">首帧按镜头时长铺满，硬切拼接</p>
          </div>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} title="关闭">
            <IconClose size={15} />
          </button>
        </div>

        <div className="export-stats">
          <div className="export-stat">
            <b>{nodes.length}</b>
            <span>镜头</span>
          </div>
          <div className="export-stat">
            <b>{formatClock(summary.duration)}</b>
            <span>总时长</span>
          </div>
          <div className="export-stat">
            <b>{resolution.label}</b>
            <span>
              {resolution.width}×{resolution.height} · {prefs.fps}fps
            </span>
          </div>
        </div>

        {!running && (
          <div className="export-options">
            <div className="export-options-title">渲染设置</div>
            <div className="export-option">
              <span className="export-option-label">分辨率</span>
              <Segmented
                label="分辨率"
                options={RES_OPTIONS}
                value={prefs.resolution}
                disabled={starting}
                onChange={(value) => updatePrefs({ resolution: value })}
              />
            </div>
            <div className="export-option">
              <span className="export-option-label">帧率</span>
              <Segmented
                label="帧率"
                options={FPS_CONTROLS}
                value={prefs.fps}
                disabled={starting}
                onChange={(value) => updatePrefs({ fps: value })}
              />
            </div>
            <div className="export-option">
              <span className="export-option-label">画面适配</span>
              <Segmented
                label="画面适配"
                options={FIT_OPTIONS}
                value={prefs.fit}
                disabled={starting}
                onChange={(value) => updatePrefs({ fit: value })}
              />
            </div>
            <div className="export-option">
              <span className="export-option-label">画质</span>
              <Segmented
                label="画质"
                options={QUALITY_OPTIONS}
                value={prefs.quality}
                disabled={starting}
                onChange={(value) => updatePrefs({ quality: value })}
              />
            </div>
            <div className="export-option">
              <span className="export-option-label">运镜</span>
              <Segmented
                label="运镜"
                options={MOTION_OPTIONS}
                value={prefs.motion}
                disabled={starting}
                onChange={(value) => updatePrefs({ motion: value })}
              />
            </div>
            {resolution.id === '4k' && (
              <p className="export-option-hint">4K 会放大小尺寸首帧，渲染耗时更长。</p>
            )}
          </div>
        )}

        <p className="modal-note">
          按镜头顺序把每个镜头的首帧铺满对应时长硬切拼接，画面
          {prefs.fit === 'cover' ? '等比放大后裁剪填满' : '等比缩放后补黑边'}。
          {prefs.motion !== 'none' && ` 每镜缓慢${prefs.motion === 'in' ? '推近' : '拉远'} 5%。`}
          {summary.stale > 0 && (
            <span className="warn"> 有 {summary.stale} 个镜头的提示词已修改，将使用最后一次生成的图。</span>
          )}
        </p>

        {running && job && (
          <div className="export-progress">
            <div className="export-progress-head">
              <span>{job.stage}</span>
              <span className="export-percent">{job.progress}%</span>
            </div>
            <div className="export-bar">
              <i style={{ width: `${Math.max(2, job.progress)}%` }} />
            </div>
            <div className="export-progress-foot">
              <span>
                {job.shots} 个镜头 · {resLabel(job.options.width, job.options.height)} · 预计{' '}
                {formatClock(job.durationSec)}
              </span>
              <button type="button" onClick={() => void cancelExport(job.id)}>
                取消合成
              </button>
            </div>
          </div>
        )}

        {!running && missing.length > 0 && (
          <div className="export-warn">
            <div className="export-warn-title">还有 {missing.length} 个镜头没有首帧</div>
            <div className="export-warn-list">
              {missing.slice(0, 12).map((no) => (
                <span key={no}>镜头 {shotLabel(no)}</span>
              ))}
              {missing.length > 12 && <span>等 {missing.length} 个</span>}
            </div>
            <label className="export-check">
              <input
                type="checkbox"
                checked={allowMissing}
                onChange={(event) => setAllowMissing(event.target.checked)}
              />
              <span>跳过这些镜头，只合成已有首帧</span>
            </label>
          </div>
        )}

        {!running && error && <div className="export-error">{error}</div>}

        {!running && job?.status === 'error' && !error && (
          <div className="export-error">{job.error || '合成失败'}</div>
        )}

        {!running && done && (
          <div className="export-preview">
            <video className="export-video" src={job.url!} controls preload="metadata" />
            <div className="export-preview-meta">
              <span>
                {job.shots} 个镜头 · {formatClock(job.durationSec)} ·{' '}
                {resLabel(job.options.width, job.options.height)} · {formatSize(job.size)}
              </span>
              <a className="export-download" href={job.url!} download={job.filename || undefined}>
                下载视频
              </a>
            </div>
          </div>
        )}

        {!running && recent.length > 0 && (
          <div className="export-history">
            <div className="export-history-title">最近合成</div>
            {recent.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`export-history-row ${job?.id === item.id ? 'on' : ''}`}
                onClick={() => viewExport(item)}
              >
                <span className="export-history-time">{formatTime(item.createdAt)}</span>
                <span className="export-history-meta">
                  {resLabel(item.options.width, item.options.height)} · {item.shots} 镜 ·{' '}
                  {formatClock(item.durationSec)} · {formatSize(item.size)}
                </span>
                <span className={`export-history-status ${item.status}`}>{statusLabel(item)}</span>
              </button>
            ))}
          </div>
        )}

        {!running && (
          <div className="modal-actions">
            <button type="button" onClick={() => setOpen(false)}>
              关闭
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canStart}
              aria-busy={starting || undefined}
              onClick={() =>
                void startExport({
                  width: resolution.width,
                  height: resolution.height,
                  fps: prefs.fps,
                  fit: prefs.fit,
                  quality: prefs.quality,
                  motion: prefs.motion,
                  allowMissing,
                })
              }
            >
              {starting ? '提交中…' : '开始合成'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
