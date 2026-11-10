import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useWorkbench } from '../../store';
import type { AudioData } from '../../types';
import {
  ChevronRight,
  Download,
  Pause,
  Play,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Button } from '../common/Button';
import { Slider } from '../common/Slider';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible';
import { Textarea } from '../ui/textarea';
import { useAudioProgress, useWaveform } from '../../audioWave';
import { clock, pad } from '../../utils/format';

const BAR_COUNT = 52;

export function AudioInspector({ node }: { node: { id: string; data: AudioData } }) {
  const data = node.data;
  const run = data.run;
  const config = useWorkbench((s) => s.project?.config);
  const projectId = useWorkbench((s) => s.projectId);
  const selectNode = useWorkbench((s) => s.selectNode);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);
  const patchAudioNode = useWorkbench((s) => s.patchAudioNode);
  const generateAudio = useWorkbench((s) => s.generateAudio);
  const selectAudioCandidate = useWorkbench((s) => s.selectAudioCandidate);
  const clearAudioRun = useWorkbench((s) => s.clearAudioRun);
  const deleteAudioNode = useWorkbench((s) => s.deleteAudioNode);

  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const autoplayRef = useRef<string | null>(null);
  const [text, setText] = useState(data.text);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [candidatesOpen, setCandidatesOpen] = useState(run.candidates.length > 1);

  const busy = run.status === 'queued' || run.status === 'running';
  const candidate =
    run.candidates.find((item) => item.id === run.selectedId) ||
    run.candidates[run.candidates.length - 1] ||
    null;
  const stale = Boolean(candidate) && run.textHash !== data.textHash;
  const duration = candidate?.durationSec || 0;
  const dirty = text.trim() !== data.text;
  const needsVoice = config ? !config.audio.hasVoice : false;
  const voiceMissing = config?.audio.hasVoice === false;
  const working = busy || submitting;

  const bars = useWaveform(candidate, projectId, node.id, BAR_COUNT, data.textHash || data.text);
  const paint = useAudioProgress({
    audioRef,
    trackRef,
    timeRef,
    duration,
    playing,
    showTotal: false,
  });

  useEffect(() => {
    setText(data.text);
    setPlaying(false);
    paint();
  }, [node.id, paint]);

  const hasManyCandidates = run.candidates.length > 1;
  useEffect(() => {
    setCandidatesOpen(hasManyCandidates);
  }, [node.id, hasManyCandidates]);

  useEffect(() => {
    if (busy) setSubmitting(false);
  }, [busy]);

  useEffect(() => {
    setPlaying(false);
    paint();
  }, [candidate?.id, paint]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = muted ? 0 : volume;
  }, [volume, muted, candidate?.id]);

  useEffect(() => {
    if (autoplayRef.current !== candidate?.id) return;
    autoplayRef.current = null;
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => setPlaying(false));
  }, [candidate?.id]);

  const statusText = busy
    ? run.status === 'queued'
      ? '排队中…'
      : '正在合成语音…'
    : run.status === 'error'
      ? run.error || '生成失败'
      : stale
        ? '文本已修改，当前音频是旧版'
        : candidate
          ? `已生成 · ${candidate.provider === 'indextts' ? 'IndexTTS' : candidate.provider}`
          : voiceMissing
            ? '未配置参考音色'
            : '未生成';

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
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

  const save = async () => {
    if (!dirty || !text.trim() || saving) return;
    setSaving(true);
    try {
      const ok = await patchAudioNode(node.id, text.trim());
      if (!ok) setText(data.text);
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    if (working || needsVoice) return;
    setSubmitting(true);
    try {
      await generateAudio(node.id, Boolean(candidate) || stale);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = () => {
    if (!window.confirm(`删除音频节点 ${pad(data.no)}？生成的音频也会一并删除。`)) {
      return;
    }
    audioRef.current?.pause();
    void deleteAudioNode(node.id);
  };

  return (
    <aside className="inspector audio-inspector">
      <header className="inspector-head">
        <div className="inspector-head-main">
          <span className="inspector-no">{pad(data.no)}</span>
          <span className="anchor-tag audio-tag">
            <Volume2 size={10} />
            音频
          </span>
          <span className="inspector-dur">{duration.toFixed(2)}s</span>
          <span
            className={`inspector-inline ${run.status === 'error' ? 'is-error' : ''}`}
            title={statusText}
          >
            {statusText}
          </span>
        </div>
        <Button variant="icon" type="button" onClick={() => selectNode(null)} title="关闭">
          <X size={15} />
        </Button>
      </header>

      <div className="inspector-scroll">
        <section className="audio-hero">
          <div
            ref={trackRef}
            className={`audio-hero-wave nodrag ${candidate ? '' : 'is-empty'}`}
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

          <div className="audio-hero-bar">
            <div className="audio-hero-volume">
              <button
                type="button"
                className="audio-hero-volbtn"
                onClick={() => setMuted((value) => !value)}
                title={muted ? '取消静音' : '静音'}
                aria-label={muted ? '取消静音' : '静音'}
              >
                {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <Slider
                className="audio-hero-slider"
                label="音量"
                value={volume}
                min={0}
                max={1}
                step={0.01}
                keyStep={0.05}
                formatValue={(next) => `${Math.round(next * 100)}%`}
                onChange={(next) => {
                  setVolume(next);
                  if (next > 0) setMuted(false);
                }}
              />
            </div>

            <div className="audio-hero-transport">
              <span className="audio-hero-time" ref={timeRef}>
                {clock(0)}
              </span>
              <button
                type="button"
                className="audio-play audio-play-lg"
                disabled={!candidate || busy}
                onClick={toggle}
                title={playing ? '暂停' : '播放'}
                aria-label={playing ? '暂停' : '播放'}
              >
                {busy ? (
                  <span className="spinner tiny" />
                ) : playing ? (
                  <Pause size={15} />
                ) : (
                  <Play size={15} />
                )}
              </button>
              <span className="audio-hero-total">{clock(duration)}</span>
            </div>

            <div className="audio-hero-actions">
              {candidate && (
                <a
                  className="audio-hero-download"
                  href={candidate.url}
                  download={candidate.filename || undefined}
                  title="下载当前音频"
                  aria-label="下载当前音频"
                >
                  <Download size={14} />
                </a>
              )}
            </div>
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
        </section>

        <div className="deck">
          <Button
            type="button"
            variant="primary"
            block
            disabled={working || needsVoice || !data.text.trim()}
            aria-busy={working}
            onClick={() => void generate()}
          >
            {working && <span className="spinner tiny" />}
            {busy
              ? run.status === 'queued'
                ? '排队中…'
                : '生成中…'
              : submitting
                ? '正在提交…'
                : candidate
                  ? '重新生成音频'
                  : '生成音频'}
          </Button>
          {voiceMissing ? (
            <div className="deck-hint">
              还没有参考音色，
              <Button type="button" className="link-mini" onClick={() => setSettingsOpen(true)}>
                去系统设置
              </Button>
            </div>
          ) : (
            run.status === 'error' && <div className="deck-error">{run.error}</div>
          )}
        </div>

        <section className="panel">
          <div className="panel-head">
            <span className="eyebrow">配音文本</span>
            <span className="audio-char-count">{text.length} 字</span>
          </div>
          <Textarea
            className="audio-text-area"
            rows={6}
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="panel-foot">
            <Button
              type="button"
              disabled={!dirty || !text.trim() || saving}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : '保存文本'}
            </Button>
          </div>
        </section>

        {run.candidates.length > 0 && (
          <Collapsible
            className="panel collapsible"
            open={candidatesOpen}
            onOpenChange={setCandidatesOpen}
          >
            <CollapsibleTrigger className="collapsible-trigger">
              <span className="eyebrow">候选音频</span>
              <span className="audio-char-count">{run.candidates.length} 条</span>
              <span className="chev">
                <ChevronRight size={14} />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="collapsible-content">
              <div className="collapsible-body audio-candidates">
                {run.candidates.map((item) => {
                  const selected = item.id === run.selectedId;
                  const rowPlaying = selected && playing;
                  return (
                    <div key={item.id} className={`audio-candidate ${selected ? 'on' : ''}`}>
                      <button
                        type="button"
                        className="audio-candidate-play"
                        onClick={() => {
                          if (selected) {
                            const audio = audioRef.current;
                            if (!audio) return;
                            if (audio.paused) void audio.play().catch(() => setPlaying(false));
                            else audio.pause();
                            return;
                          }
                          autoplayRef.current = item.id;
                          void selectAudioCandidate(node.id, item.id);
                        }}
                        title={rowPlaying ? '暂停' : '播放这条候选'}
                        aria-label={rowPlaying ? '暂停' : '播放这条候选'}
                      >
                        {rowPlaying ? <Pause size={11} /> : <Play size={11} />}
                      </button>
                      <button
                        type="button"
                        className="audio-candidate-main"
                        onClick={() => void selectAudioCandidate(node.id, item.id)}
                      >
                        <span className="audio-candidate-duration">
                          {item.durationSec.toFixed(2)}s
                        </span>
                        <span className="audio-candidate-meta">
                          {new Date(item.createdAt).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {selected && <span className="audio-candidate-badge">使用中</span>}
                      </button>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      <footer className="inspector-foot">
        {run.candidates.length > 0 && (
          <Button
            type="button"
            className="audio-clear-btn"
            onClick={() => void clearAudioRun(node.id)}
            disabled={busy}
          >
            清空音频
          </Button>
        )}
        <Button type="button" className="audio-delete-btn" onClick={remove}>
          <Trash2 size={13} />
          删除节点
        </Button>
      </footer>
    </aside>
  );
}
