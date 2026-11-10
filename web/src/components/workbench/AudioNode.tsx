import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { AudioLines, Pause, Play } from 'lucide-react';
import { useWorkbench } from '../../store';
import type { AudioData } from '../../types';
import { useAudioProgress, useWaveform } from '../../audioWave';
import { clock, pad } from '../../utils/format';

const BAR_COUNT = 36;

export function AudioNode({ id, data, selected }: NodeProps<Node<AudioData>>) {
  const projectId = useWorkbench((s) => s.projectId);
  const edges = useWorkbench((s) => s.edges);
  const hasIncoming = edges.some(
    (edge) => edge.target === id && (edge.data as { kind?: string } | undefined)?.kind === 'audio',
  );
  const hasOutgoing = edges.some(
    (edge) => edge.source === id && (edge.data as { kind?: string } | undefined)?.kind === 'audio',
  );
  const run = data.run;
  const busy = run.status === 'queued' || run.status === 'running';
  const candidate =
    run.candidates.find((item) => item.id === run.selectedId) ||
    run.candidates[run.candidates.length - 1] ||
    null;
  const stale = Boolean(candidate) && !busy && run.textHash !== data.textHash;
  const failed = run.status === 'error';

  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const duration = candidate?.durationSec || 0;
  const bars = useWaveform(candidate, projectId, id, BAR_COUNT, data.textHash || data.text);
  const paint = useAudioProgress({ audioRef, trackRef, timeRef, duration, playing });

  useEffect(() => {
    setPlaying(false);
    paint();
  }, [candidate?.id, paint]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  const seekAt = (clientX: number, element: HTMLElement) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = element.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    paint();
  };

  const startSeek = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekAt(event.clientX, event.currentTarget);
  };

  const moveSeek = (event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return;
    seekAt(event.clientX, event.currentTarget);
  };

  let badge = '';
  if (failed) badge = '生成失败';
  else if (stale) badge = '文本已改';
  else if (!candidate && !busy) badge = '未生成';

  const tone = failed ? 'is-error' : busy ? 'is-running' : stale ? 'is-stale' : '';

  return (
    <div className={`audio-node ${selected ? 'is-selected' : ''} ${tone}`}>
      <Handle
        type="target"
        position={Position.Left}
        className={`port ${hasIncoming ? 'is-locked' : ''}`}
        isConnectable={!hasIncoming}
      />
      <div className="node-card audio-card">
        <header className="audio-head">
          <span className="audio-no">音频 {pad(data.no)}</span>
          {badge && (
            <span
              className={`audio-badge ${failed ? 'error' : stale || !candidate ? 'warn' : ''}`}
              title={failed ? run.error || '生成失败' : undefined}
            >
              {badge}
            </span>
          )}
          <span className="audio-head-meta">
            {busy ? (run.status === 'queued' ? '排队中' : '生成中') : `${duration.toFixed(2)}s`}
          </span>
        </header>

        <div className="audio-body">
          <button
            type="button"
            className={`audio-play nodrag ${candidate ? '' : 'is-empty'}`}
            disabled={!candidate || busy}
            onClick={toggle}
            title={playing ? '暂停' : '播放'}
            aria-label={playing ? '暂停' : '播放'}
          >
            {busy ? (
              <span className="spinner tiny" />
            ) : playing ? (
              <Pause size={13} />
            ) : candidate ? (
              <Play size={13} />
            ) : (
              <AudioLines size={13} />
            )}
          </button>

          <div
            ref={trackRef}
            className={`audio-track nodrag ${candidate ? '' : 'is-empty'}`}
            onPointerDown={startSeek}
            onPointerMove={moveSeek}
            role="presentation"
          >
            <span className="audio-wave audio-wave-base" aria-hidden="true">
              {bars.map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ))}
            </span>
            <span className="audio-wave audio-wave-fill" aria-hidden="true">
              {bars.map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ))}
            </span>
            {busy && <span className="audio-scan" aria-hidden="true" />}
          </div>

          <span className="audio-time" ref={timeRef}>
            {candidate ? `${clock(0)} / ${clock(duration)}` : clock(0)}
          </span>
        </div>

        <div className="audio-text" title={data.text}>
          {data.text}
        </div>

        {candidate && (
          <audio
            ref={audioRef}
            src={candidate.url}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={paint}
            onLoadedMetadata={paint}
            onEnded={(event) => {
              setPlaying(false);
              event.currentTarget.currentTime = 0;
              paint();
            }}
          />
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className={`port ${hasOutgoing ? 'is-locked' : ''}`}
        isConnectable={!hasOutgoing}
      />
    </div>
  );
}
