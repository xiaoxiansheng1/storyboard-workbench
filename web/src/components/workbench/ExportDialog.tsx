import { useEffect, useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import { useWorkbench } from '../../store';
import { Download } from 'lucide-react';
import type {
  ExportFit,
  ExportJob,
  ExportMotion,
  ExportQuality,
  ExportTransition,
  ShotData,
} from '../../types';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Segmented } from '../common/Segmented';
import { readStoredJson, writeStoredJson } from '../../utils/storage';
import { clock, formatDateTime, formatSize, pad } from '../../utils/format';

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

const TRANSITION_OPTIONS: { value: ExportTransition; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'crossfade', label: '叠化' },
  { value: 'fade', label: '黑场' },
];

const TRANSITION_SECONDS = [0.2, 0.3, 0.4, 0.5] as const;

const RENDER_KEY = 'storyboard-export-render';

interface RenderPrefs {
  resolution: ResolutionOption['id'];
  fps: number;
  fit: ExportFit;
  quality: ExportQuality;
  motion: ExportMotion;
  transition: ExportTransition;
  transitionSec: number;
}

const DEFAULT_PREFS: RenderPrefs = {
  resolution: '1080p',
  fps: 30,
  fit: 'contain',
  quality: 'standard',
  motion: 'none',
  transition: 'crossfade',
  transitionSec: 0.3,
};

function readPrefs(): RenderPrefs {
  const value = readStoredJson<Partial<RenderPrefs>>('local', RENDER_KEY);
  if (!value) return DEFAULT_PREFS;
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
    transition:
      value.transition === 'none' || value.transition === 'fade' ? value.transition : 'crossfade',
    transitionSec: TRANSITION_SECONDS.includes(
      value.transitionSec as (typeof TRANSITION_SECONDS)[number],
    )
      ? (value.transitionSec as number)
      : DEFAULT_PREFS.transitionSec,
  };
}

function savePrefs(prefs: RenderPrefs) {
  writeStoredJson('local', RENDER_KEY, prefs);
}

function selectedCandidate(node: Node<ShotData>) {
  const run = node.data.run;
  return (
    run.candidates.find((item) => item.id === run.selectedId) ||
    run.candidates[run.candidates.length - 1]
  );
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

const FIT_LABEL: Record<ExportFit, string> = { contain: '留黑边', cover: '裁剪填满' };
const MOTION_LABEL: Record<ExportMotion, string> = { none: '无运镜', in: '推近', out: '拉远' };
const TRANSITION_LABEL: Record<ExportTransition, string> = {
  none: '无过渡',
  crossfade: '叠化',
  fade: '黑场',
};

function jobSummary(job: ExportJob): string {
  const motion = job.options.motion || 'none';
  const transition = job.options.transition || 'none';
  const parts = [resLabel(job.options.width, job.options.height), `${job.options.fps}fps`];
  if (motion !== 'none') parts.push(MOTION_LABEL[motion]);
  if (transition !== 'none') {
    parts.push(`${TRANSITION_LABEL[transition]} ${job.options.transitionSec ?? 0.3}s`);
  }
  return parts.join(' · ');
}

function progressHint(job: ExportJob): string {
  const total = `总长 ${clock(job.durationSec)}`;
  if (job.status !== 'running' || job.progress < 3) return total;
  const elapsed = (Date.now() - Date.parse(job.createdAt)) / 1000;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return total;
  const remain = (elapsed / job.progress) * (100 - job.progress);
  if (!Number.isFinite(remain) || remain < 5) return total;
  return `剩余约 ${clock(remain)}`;
}

function previewSrc(job: ExportJob, retry: number): string {
  const stamp = job.finishedAt ? Date.parse(job.finishedAt) || job.id : job.id;
  return `${job.url}?v=${stamp}${retry ? `-${retry}` : ''}`;
}

function historySummary(job: ExportJob): string {
  const motion = job.options.motion || 'none';
  const transition = job.options.transition || 'none';
  const parts = [resLabel(job.options.width, job.options.height)];
  if (motion !== 'none') parts.push(MOTION_LABEL[motion]);
  if (transition !== 'none') parts.push(TRANSITION_LABEL[transition]);
  parts.push(`${job.shots} 镜`, clock(job.durationSec), formatSize(job.size));
  return parts.join(' · ');
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
  const shots = useMemo(
    () => nodes.filter((node): node is Node<ShotData> => node.type !== 'audio'),
    [nodes],
  );
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
  const [media, setMedia] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);

  const updatePrefs = (patch: Partial<RenderPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  };

  useEffect(() => {
    if (open) setAllowMissing(false);
    else setRetry(0);
  }, [open]);

  const src = job?.url ? previewSrc(job, retry) : null;

  useEffect(() => {
    setMedia('loading');
  }, [src]);

  const summary = useMemo(() => {
    let duration = 0;
    let stale = 0;
    const missing: number[] = [];
    for (const node of shots) {
      duration += Number(node.data.duration) || 0;
      if (node.data.video?.filename) continue;
      const candidate = selectedCandidate(node);
      if (!candidate) {
        missing.push(node.data.no);
        continue;
      }
      if (node.data.run.promptHash !== node.data.promptHash) stale += 1;
    }
    return { duration, stale, missing };
  }, [shots]);

  if (!open) return null;

  const resolution = RESOLUTIONS.find((item) => item.id === prefs.resolution) ?? RESOLUTIONS[1];
  const running = job?.status === 'queued' || job?.status === 'running';
  const missing = Array.from(new Set([...summary.missing, ...missingFromServer])).sort(
    (a, b) => a - b,
  );
  const blocked = missing.length > 0 && !allowMissing;
  const canStart = shots.length > 0 && !blocked && !running && !starting;
  const done = job?.status === 'done' && Boolean(job.url);
  const recent = history.slice(0, 6);

  return (
    <Modal
      title="合成视频"
      onClose={() => setOpen(false)}
      footer={
        !running ? (
          <>
            <Button type="button" onClick={() => setOpen(false)}>
              关闭
            </Button>
            <Button
              type="button"
              variant="primary"
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
                  transition: prefs.transition,
                  transitionSec: prefs.transitionSec,
                  allowMissing,
                })
              }
            >
              {starting ? '提交中…' : done ? '重新合成' : '开始合成'}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="export-stats">
        <div className="export-stat">
          <span>镜头</span>
          <b>{shots.length}</b>
        </div>
        <div className="export-stat">
          <span>总时长</span>
          <b>{clock(summary.duration)}</b>
        </div>
        <div className="export-stat">
          <span>分辨率</span>
          <b>{resolution.label}</b>
          <span>
            {resolution.width}×{resolution.height} · {prefs.fps}fps
          </span>
        </div>
      </div>

      {running && job && (
        <div className="export-progress">
          <div className="export-progress-top">
            <span className="export-pulse" />
            <div className="export-progress-text">
              <b>{job.stage}</b>
              <span>
                {jobSummary(job)} · {progressHint(job)}
              </span>
            </div>
            <span className="export-percent">
              {job.progress}
              <i>%</i>
            </span>
          </div>
          <div className="export-bar">
            <i style={{ width: `${Math.max(2, job.progress)}%` }} />
          </div>
          <div className="export-progress-foot">
            <span>可以关闭弹窗，合成会在后台继续</span>
            <Button
              type="button"
              className="export-cancel"
              onClick={() => void cancelExport(job.id)}
            >
              取消合成
            </Button>
          </div>
        </div>
      )}

      {!running && done && job && (
        <div className="export-result">
          <div className="export-result-head">
            <span className="export-result-title">渲染结果</span>
            <span className="export-result-badge">{jobSummary(job)}</span>
          </div>
          <div className="export-player">
            <video
              key={src!}
              className="export-video"
              src={src!}
              controls
              playsInline
              preload="auto"
              onLoadedData={() => setMedia('ready')}
              onError={() => setMedia('error')}
            />
            {media !== 'ready' && (
              <div className={`export-player-state ${media === 'error' ? 'is-error' : ''}`}>
                {media === 'error' ? (
                  <>
                    <span>预览加载失败，可下载后播放</span>
                    <Button
                      type="button"
                      className="export-retry"
                      onClick={() => {
                        setMedia('loading');
                        setRetry((n) => n + 1);
                      }}
                    >
                      重新加载
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="export-spinner" />
                    <span>正在载入预览…</span>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="export-result-foot">
            <span>
              {job.shots} 个镜头 · {clock(job.durationSec)} · {formatSize(job.size)} ·{' '}
              {FIT_LABEL[job.options.fit || 'contain']}
            </span>
            <a className="export-download" href={job.url!} download={job.filename || undefined}>
              <Download size={13} />
              下载视频
            </a>
          </div>
        </div>
      )}

      {!running && missing.length > 0 && (
        <div className="export-warn">
          <div className="export-warn-title">还有 {missing.length} 个镜头没有首帧</div>
          <div className="export-warn-list">
            {missing.slice(0, 12).map((no) => (
              <span key={no}>镜头 {pad(no)}</span>
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
              compact
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
              compact
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
              compact
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
              compact
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
              compact
              onChange={(value) => updatePrefs({ motion: value })}
            />
          </div>
          <div className="export-option">
            <span className="export-option-label">过渡</span>
            <Segmented
              label="镜头过渡"
              options={TRANSITION_OPTIONS}
              value={prefs.transition}
              disabled={starting}
              compact
              onChange={(value) => updatePrefs({ transition: value })}
            />
          </div>
          {prefs.transition !== 'none' && (
            <div className="export-option">
              <span className="export-option-label">过渡时长</span>
              <Segmented
                label="过渡时长"
                options={TRANSITION_SECONDS.map((value) => ({
                  value,
                  label: `${value.toFixed(1)}s`,
                }))}
                value={prefs.transitionSec}
                disabled={starting}
                compact
                onChange={(value) => updatePrefs({ transitionSec: value })}
              />
            </div>
          )}
          {prefs.transition === 'crossfade' && (
            <p className="export-option-hint">
              叠化会让相邻镜头定格画面交叠，总时长不变，渲染略慢。
            </p>
          )}
          {resolution.id === '4k' && (
            <p className="export-option-hint">4K 会放大小尺寸首帧，渲染耗时更长。</p>
          )}
        </div>
      )}

      {!running && summary.stale > 0 && (
        <p className="modal-note">
          有 {summary.stale} 个镜头的提示词已修改，将使用最后一次生成的图。
        </p>
      )}

      {!running && recent.length > 0 && (
        <div className="export-history">
          <div className="export-history-title">最近合成</div>
          {recent.map((item) => (
            <Button
              key={item.id}
              type="button"
              className={`export-history-row ${job?.id === item.id ? 'on' : ''}`}
              onClick={() => viewExport(item)}
            >
              <span className="export-history-time">{formatDateTime(item.createdAt)}</span>
              <span className="export-history-meta">{historySummary(item)}</span>
              <span className={`export-history-status ${item.status}`}>{statusLabel(item)}</span>
            </Button>
          ))}
        </div>
      )}
    </Modal>
  );
}
