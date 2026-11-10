import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ShotData } from '../../types';
import { Film, Image as ImageIcon } from 'lucide-react';
import { pad, shortTimecode } from '../../utils/format';

export function ShotNode({ data, selected }: NodeProps<Node<ShotData>>) {
  const run = data.run;
  const busy = run.status === 'queued' || run.status === 'running';
  const stale = !busy && run.candidates.some((candidate) => candidate.promptHash !== data.promptHash);

  const selectedIndex = Math.max(
    0,
    run.candidates.findIndex((candidate) => candidate.id === run.selectedId),
  );
  const selectedCandidate = run.candidates[selectedIndex] || null;
  const video = data.video || null;
  const progress =
    run.progress && run.progress.total
      ? Math.round((run.progress.done / run.progress.total) * 100)
      : 0;
  const busyLabel = run.status === 'queued' ? '排队中…' : '正在生成首帧…';

  let flagLabel = '';
  let flagTone = '';
  let flagTitle = '';
  if (run.status === 'error') {
    flagLabel = '生成失败';
    flagTone = 'error';
    flagTitle = run.error || '生成失败';
  } else if (stale) {
    flagLabel = '提示词已改';
    flagTone = 'stale';
    flagTitle = '提示词已改，当前图是旧版';
  }

  const tone = run.status === 'error' ? 'is-error' : busy ? 'is-running' : stale ? 'is-stale' : '';
  const enterDelay = Math.min((data.no - 1) * 16, 360);

  return (
    <div
      className={`shot-node ${data.anchor === 'B' ? 'anchor-b' : 'anchor-a'} ${
        selected ? 'is-selected' : ''
      } ${tone}`}
      style={{ animationDelay: `${enterDelay}ms` }}
    >
      <Handle type="target" position={Position.Left} className="port" />

      <div className="node-card">
        <header className="node-head">
          <span className="shot-no">镜头 {pad(data.no)}</span>
          <span
            className={`anchor-tag ${data.anchor === 'B' ? 'b' : 'a'}`}
            title={data.anchor === 'B' ? '空镜锚点' : '人物锚点'}
          >
            {data.anchor}
          </span>
          <span className="node-head-meta">
            <span className="node-time">{shortTimecode(data.srtStart)}</span>
            <span className="node-dur">{data.duration.toFixed(2)}s</span>
          </span>
        </header>

        <div
          className="node-frame"
          title={
            video
              ? `镜头 ${data.no} 已上传视频，合成时优先使用`
              : selectedCandidate
                ? `镜头 ${data.no} 首帧`
                : '还没有首帧'
          }
        >
          {selectedCandidate ? (
            <img src={selectedCandidate.url} alt={`镜头 ${data.no}`} loading="lazy" draggable={false} />
          ) : busy ? (
            <div className="frame-empty is-loading">
              <span className="frame-spinner">
                <span className="spinner" />
              </span>
              <span className="frame-empty-label">{busyLabel}</span>
              <span className="marquee" aria-hidden="true">
                <span>AI 正在绘制 · GENERATING · AI 正在绘制 · GENERATING ·&nbsp;</span>
              </span>
              <span className="scan" />
            </div>
          ) : video?.posterUrl ? (
            <img
              className="is-poster"
              src={video.posterUrl}
              alt={`镜头 ${data.no} 视频`}
              loading="lazy"
              draggable={false}
            />
          ) : (
            <div className="frame-empty">
              <span className="frame-glyph">
                <ImageIcon size={30} />
              </span>
              <span className="frame-empty-label">首帧未生成</span>
            </div>
          )}

          {busy && selectedCandidate && (
            <div className="frame-loading">
              <span className="frame-loading-badge">
                <span className="spinner tiny" />
                {busyLabel}
              </span>
              <span className="marquee" aria-hidden="true">
                <span>AI 正在绘制 · GENERATING · AI 正在绘制 · GENERATING ·&nbsp;</span>
              </span>
              <span className="scan" />
            </div>
          )}

          {busy && (
            <div className="frame-bar">
              <span
                style={{ width: run.status === 'queued' ? '10%' : `${Math.max(10, progress)}%` }}
              />
            </div>
          )}

          {!busy && flagLabel && (
            <span className={`node-flag ${flagTone}`} title={flagTitle}>
              {flagLabel}
            </span>
          )}

          {video && (
            <span
              className="node-video"
              title={`已上传视频 ${video.durationSec.toFixed(2)}s，合成时优先使用`}
            >
              <Film size={11} />
              {video.durationSec.toFixed(1)}s
            </span>
          )}
        </div>

        {data.caption && (
          <div className="node-caption" title={data.caption}>
            {data.caption}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="port" />
    </div>
  );
}
