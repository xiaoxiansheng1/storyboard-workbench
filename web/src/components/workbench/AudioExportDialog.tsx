import { useEffect, useMemo, useState } from 'react';
import { AudioLines, Download } from 'lucide-react';
import { useWorkbench } from '../../store';
import type {
  AudioData,
  AudioEnhance,
  AudioExportJob,
  AudioExportOptions,
  AudioFormat,
  AudioPauseMode,
} from '../../types';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Segmented } from '../common/Segmented';
import { Slider } from '../common/Slider';

type PauseMode = AudioPauseMode;

const FORMAT_OPTIONS: { value: AudioFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
];

const ENHANCE_OPTIONS: { value: AudioEnhance; label: string }[] = [
  { value: 'off', label: '原声' },
  { value: 'level', label: '响度均衡' },
  { value: 'voice', label: '人声增强' },
];

const PAUSE_OPTIONS: { value: PauseMode; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'light', label: '轻微' },
  { value: 'standard', label: '标准' },
  { value: 'tight', label: '紧凑' },
  { value: 'custom', label: '自定义' },
];

const PAUSE_PRESETS: Record<Exclude<PauseMode, 'custom'>, { threshold: number; target: number }> = {
  off: { threshold: 0, target: 0 },
  light: { threshold: 1, target: 0.4 },
  standard: { threshold: 0.6, target: 0.3 },
  tight: { threshold: 0.4, target: 0.2 },
};

const BITRATE_OPTIONS = [128, 192, 320].map((value) => ({
  value,
  label: `${value}k`,
}));

const BITS_OPTIONS = [16, 24].map((value) => ({
  value,
  label: `${value}bit`,
}));

const CHANNEL_OPTIONS: { value: 1 | 2; label: string }[] = [
  { value: 1, label: '单声道' },
  { value: 2, label: '立体声' },
];

const STORAGE_KEY = 'storyboard.audioExport.settings';

interface Settings {
  format: AudioFormat;
  gapSec: number;
  gainDb: number;
  enhance: AudioEnhance;
  bitrate: number;
  bits: number;
  channels: 1 | 2;
  pauseMode: PauseMode;
  pauseThresholdSec: number;
  pauseTargetSec: number;
}

const DEFAULTS: Settings = {
  format: 'mp3',
  gapSec: 0,
  gainDb: 0,
  enhance: 'level',
  bitrate: 192,
  bits: 16,
  channels: 1,
  pauseMode: 'standard',
  pauseThresholdSec: 0.6,
  pauseTargetSec: 0.3,
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    const pauseMode: PauseMode = ['off', 'light', 'standard', 'tight', 'custom'].includes(
      raw.pauseMode,
    )
      ? raw.pauseMode
      : DEFAULTS.pauseMode;
    const enhance: AudioEnhance = ['off', 'level', 'voice'].includes(raw.enhance)
      ? raw.enhance
      : DEFAULTS.enhance;
    return {
      format: raw.format === 'wav' ? 'wav' : 'mp3',
      gapSec: round1(clamp(raw.gapSec, 0, 2, 0)),
      gainDb: round1(clamp(raw.gainDb, -12, 12, 0)),
      enhance,
      bitrate: [128, 192, 320].includes(Number(raw.bitrate)) ? Number(raw.bitrate) : 192,
      bits: Number(raw.bits) === 24 ? 24 : 16,
      channels: Number(raw.channels) === 2 ? 2 : 1,
      pauseMode,
      pauseThresholdSec: round1(clamp(raw.pauseThresholdSec, 0.3, 2, 0.6)),
      pauseTargetSec: round1(clamp(raw.pauseTargetSec, 0.1, 1, 0.3)),
    };
  } catch {
    return DEFAULTS;
  }
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
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

function statusLabel(job: AudioExportJob): string {
  if (job.status === 'done') return '已完成';
  if (job.status === 'error') return '失败';
  if (job.status === 'canceled') return '已取消';
  return job.stage;
}

function jobSummary(job: AudioExportJob): string {
  const options: AudioExportOptions = job.options || ({} as AudioExportOptions);
  const parts = [
    String(options.format || 'mp3').toUpperCase(),
    `${job.nodes} 条`,
    clock(job.durationSec),
    formatSize(job.size),
  ];
  const gap = Number(options.gapSec) || 0;
  if (gap > 0) parts.push(`间隔 ${gap.toFixed(1)}s`);
  const gain = Number(options.gainDb) || 0;
  if (gain) parts.push(`${gain > 0 ? '+' : ''}${gain.toFixed(1)}dB`);
  if (options.enhance === 'voice') parts.push('人声增强');
  else if (options.enhance === 'level') parts.push('响度均衡');
  if (options.pauseMode && options.pauseMode !== 'off') {
    parts.push(`停顿 ${(Number(options.pauseTargetSec) || 0).toFixed(1)}s`);
  }
  return parts.join(' · ');
}

function pauseNote(job: AudioExportJob): string {
  const options = job.options;
  if (!options?.pauseMode || options.pauseMode === 'off') return '';
  return ` · 停顿 ${(Number(options.pauseTargetSec) || 0).toFixed(1)}s`;
}

const SILENCE_PEAK = 0.08;

function estimateClipSeconds(
  candidate: { durationSec: number; peaks?: number[] },
  pauseMode: PauseMode,
  threshold: number,
  target: number,
): number {
  const duration = Number(candidate.durationSec) || 0;
  const peaks = candidate.peaks;
  if (pauseMode === 'off' || !duration || !Array.isArray(peaks) || peaks.length < 8) return duration;
  const unit = duration / peaks.length;
  let saved = 0;
  let runStart = -1;
  for (let index = 0; index <= peaks.length; index += 1) {
    const silent = index < peaks.length && peaks[index] < SILENCE_PEAK;
    if (silent && runStart < 0) {
      runStart = index;
      continue;
    }
    if (silent || runStart < 0) continue;
    const runLength = (index - runStart) * unit;
    if (runStart === 0 || index === peaks.length) saved += Math.max(0, runLength - 0.04);
    else if (runLength >= threshold) saved += Math.max(0, runLength - target);
    runStart = -1;
  }
  return Math.max(0.2, duration - saved);
}

export function AudioExportDialog() {
  const open = useWorkbench((s) => s.audioExportOpen);
  const setOpen = useWorkbench((s) => s.setAudioExportOpen);
  const nodes = useWorkbench((s) => s.nodes);
  const job = useWorkbench((s) => s.audioExportJob);
  const history = useWorkbench((s) => s.audioExportHistory);
  const missingFromServer = useWorkbench((s) => s.audioExportMissing);
  const error = useWorkbench((s) => s.audioExportError);
  const starting = useWorkbench((s) => s.audioExportStarting);
  const startAudioExport = useWorkbench((s) => s.startAudioExport);
  const cancelAudioExport = useWorkbench((s) => s.cancelAudioExport);
  const viewAudioExport = useWorkbench((s) => s.viewAudioExport);

  const saved = useMemo(loadSettings, []);
  const [format, setFormat] = useState<AudioFormat>(saved.format);
  const [gapSec, setGapSec] = useState(saved.gapSec);
  const [gainDb, setGainDb] = useState(saved.gainDb);
  const [enhance, setEnhance] = useState<AudioEnhance>(saved.enhance);
  const [bitrate, setBitrate] = useState(saved.bitrate);
  const [bits, setBits] = useState(saved.bits);
  const [channels, setChannels] = useState<1 | 2>(saved.channels);
  const [pauseMode, setPauseMode] = useState<PauseMode>(saved.pauseMode);
  const [pauseThresholdSec, setPauseThresholdSec] = useState(saved.pauseThresholdSec);
  const [pauseTargetSec, setPauseTargetSec] = useState(saved.pauseTargetSec);
  const [allowMissing, setAllowMissing] = useState(false);

  useEffect(() => {
    if (open) setAllowMissing(false);
  }, [open]);

  const summary = useMemo(() => {
    let duration = 0;
    let clips = 0;
    const missing: number[] = [];
    for (const node of nodes) {
      if (node.type !== 'audio') continue;
      const run = (node.data as AudioData).run;
      const candidate =
        run.candidates.find((item) => item.id === run.selectedId) ||
        run.candidates[run.candidates.length - 1];
      if (!candidate) {
        missing.push(node.data.no);
        continue;
      }
      clips += 1;
      duration += estimateClipSeconds(candidate, pauseMode, pauseThresholdSec, pauseTargetSec);
    }
    duration += gapSec * Math.max(0, clips - 1);
    return { total: clips + missing.length, clips, duration, missing };
  }, [nodes, gapSec, pauseMode, pauseThresholdSec, pauseTargetSec]);

  if (!open) return null;

  const running = job?.status === 'queued' || job?.status === 'running';
  const missing = Array.from(new Set([...summary.missing, ...missingFromServer])).sort(
    (a, b) => a - b,
  );
  const blocked = missing.length > 0 && !allowMissing;
  const canStart = summary.clips > 0 && !blocked && !running && !starting;
  const done = job?.status === 'done' && Boolean(job.url);
  const recent = history.slice(0, 6);
  const src = job?.url
    ? `${job.url}?v=${job.finishedAt ? Date.parse(job.finishedAt) || job.id : job.id}`
    : null;

  const choosePause = (mode: PauseMode) => {
    setPauseMode(mode);
    if (mode === 'custom') return;
    const preset = PAUSE_PRESETS[mode];
    setPauseThresholdSec(preset.threshold);
    setPauseTargetSec(preset.target);
  };

  const changePauseThreshold = (next: number) => {
    setPauseMode('custom');
    setPauseThresholdSec(next);
    setPauseTargetSec((current) => Math.min(current, Math.max(0.1, round1(next - 0.1))));
  };

  const changePauseTarget = (next: number) => {
    setPauseMode('custom');
    setPauseTargetSec(Math.min(next, Math.max(0.1, round1(pauseThresholdSec - 0.1))));
  };

  const start = () => {
    const settings: Settings = {
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
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 隐私模式下写不了本地存储，不影响本次导出
    }
    void startAudioExport({
      ...settings,
      allowMissing,
      nodeIds: [],
    });
  };

  return (
    <Modal
      title="合成音频"
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
              onClick={start}
            >
              {starting ? '提交中…' : done ? '重新合成' : '开始合成'}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="export-stats">
        <div className="export-stat">
          <span>音频节点</span>
          <b>{summary.total}</b>
        </div>
        <div className="export-stat">
          <span>可合成</span>
          <b>{summary.clips}</b>
        </div>
        <div className="export-stat">
          <span>预计</span>
          <b>{clock(summary.duration)}</b>
        </div>
      </div>

      {running && job && (
        <div className="export-progress">
          <div className="export-progress-top">
            <span className="export-pulse" />
            <div className="export-progress-text">
              <b>{job.stage}</b>
              <span>{jobSummary(job)}</span>
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
              onClick={() => void cancelAudioExport(job.id)}
            >
              取消合成
            </Button>
          </div>
        </div>
      )}

      {!running && done && job && src && (
        <div className="export-result">
          <div className="export-result-head">
            <span className="export-result-title">合成结果</span>
            <span className="export-result-badge">{jobSummary(job)}</span>
          </div>
          <div className="audio-result-player">
            <span className="audio-result-glyph">
              <AudioLines size={16} />
            </span>
            <audio key={src} src={src} controls preload="metadata" />
          </div>
          <div className="export-result-foot">
            <span>
              {job.nodes} 条 · {clock(job.durationSec)} · {formatSize(job.size)}
            </span>
            <a className="export-download" href={job.url!} download={job.filename || undefined}>
              <Download size={13} />
              下载音频
            </a>
          </div>
        </div>
      )}

      {!running && missing.length > 0 && (
        <div className="export-warn">
          <div className="export-warn-title">还有 {missing.length} 个音频节点没有生成</div>
          <div className="export-warn-list">
            {missing.slice(0, 12).map((no) => (
              <span key={no}>音频 {String(no).padStart(2, '0')}</span>
            ))}
            {missing.length > 12 && <span>等 {missing.length} 个</span>}
          </div>
          <label className="export-check">
            <input
              type="checkbox"
              checked={allowMissing}
              onChange={(event) => setAllowMissing(event.target.checked)}
            />
            <span>跳过这些节点，只合成已生成的音频</span>
          </label>
        </div>
      )}

      {!running && error && <div className="export-error">{error}</div>}

      {!running && job?.status === 'error' && !error && (
        <div className="export-error">{job.error || '合成失败'}</div>
      )}

      {!running && (
        <div className="export-options">
          <div className="export-options-title">导出设置</div>

          <div className="export-option">
            <span className="export-option-label">格式</span>
            <Segmented
              label="格式"
              options={FORMAT_OPTIONS}
              value={format}
              disabled={starting}
              compact
              onChange={(value) => setFormat(value)}
            />
          </div>

          <div className="export-option">
            <span className="export-option-label">节点间隔</span>
            <div className="export-slider">
              <Slider
                label="节点间隔"
                value={gapSec}
                min={0}
                max={2}
                step={0.1}
                disabled={starting}
                formatValue={(value) => (value === 0 ? '无缝' : `${value.toFixed(1)} 秒`)}
                onChange={setGapSec}
              />
              <span className="export-slider-value">
                {gapSec === 0 ? '无缝' : `${gapSec.toFixed(1)}s`}
              </span>
            </div>
          </div>

          <div className="export-option">
            <span className="export-option-label">音量</span>
            <div className="export-slider">
              <Slider
                label="音量"
                value={gainDb}
                min={-12}
                max={12}
                step={0.5}
                keyStep={1}
                disabled={starting}
                formatValue={(value) =>
                  value === 0 ? '原声' : `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`
                }
                onChange={setGainDb}
              />
              <span className="export-slider-value">
                {gainDb === 0 ? '0 dB' : `${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB`}
              </span>
            </div>
          </div>

          <div className="export-option">
            <span className="export-option-label">停顿整理</span>
            <Segmented
              label="停顿整理"
              options={PAUSE_OPTIONS}
              value={pauseMode}
              disabled={starting}
              compact
              onChange={choosePause}
            />
          </div>

          {pauseMode === 'custom' && (
            <>
              <div className="export-option">
                <span className="export-option-label">长停顿</span>
                <div className="export-slider">
                  <Slider
                    label="长停顿判定"
                    value={pauseThresholdSec}
                    min={0.3}
                    max={2}
                    step={0.1}
                    disabled={starting}
                    formatValue={(value) => `超过 ${value.toFixed(1)} 秒`}
                    onChange={changePauseThreshold}
                  />
                  <span className="export-slider-value">≥{pauseThresholdSec.toFixed(1)}s</span>
                </div>
              </div>
              <div className="export-option">
                <span className="export-option-label">压缩到</span>
                <div className="export-slider">
                  <Slider
                    label="停顿压缩到"
                    value={pauseTargetSec}
                    min={0.1}
                    max={1}
                    step={0.1}
                    disabled={starting}
                    formatValue={(value) => `${value.toFixed(1)} 秒`}
                    onChange={changePauseTarget}
                  />
                  <span className="export-slider-value">{pauseTargetSec.toFixed(1)}s</span>
                </div>
              </div>
            </>
          )}

          <div className="export-option">
            <span className="export-option-label">音质处理</span>
            <Segmented
              label="音质处理"
              options={ENHANCE_OPTIONS}
              value={enhance}
              disabled={starting}
              compact
              onChange={(value) => setEnhance(value)}
            />
          </div>

          <div className="export-option">
            <span className="export-option-label">{format === 'wav' ? '位深' : '码率'}</span>
            <Segmented
              label={format === 'wav' ? '位深' : '码率'}
              options={format === 'wav' ? BITS_OPTIONS : BITRATE_OPTIONS}
              value={format === 'wav' ? bits : bitrate}
              disabled={starting}
              compact
              onChange={(value) => {
                if (format === 'wav') setBits(value);
                else setBitrate(value);
              }}
            />
          </div>

          <div className="export-option">
            <span className="export-option-label">声道</span>
            <Segmented
              label="声道"
              options={CHANNEL_OPTIONS}
              value={channels}
              disabled={starting}
              compact
              onChange={(value) => setChannels(value)}
            />
          </div>
        </div>
      )}

      {!running && recent.length > 0 && (
        <div className="export-history">
          <div className="export-history-title">最近合成</div>
          {recent.map((item) => (
            <Button
              key={item.id}
              type="button"
              className={`export-history-row ${job?.id === item.id ? 'on' : ''}`}
              onClick={() => viewAudioExport(item)}
            >
              <span className="export-history-time">{formatTime(item.createdAt)}</span>
              <span className="export-history-meta">
                {String(item.options.format || 'mp3').toUpperCase()} · {item.nodes} 条 ·{' '}
                {clock(item.durationSec)} · {formatSize(item.size)}
                {pauseNote(item)}
              </span>
              <span className={`export-history-status ${item.status}`}>{statusLabel(item)}</span>
            </Button>
          ))}
        </div>
      )}
    </Modal>
  );
}
