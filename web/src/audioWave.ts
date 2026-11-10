import { useCallback, useEffect, useMemo, useState } from 'react';
import { clock } from './utils/format';
import { api } from './api';
import type { AudioCandidate } from './types';

type AudioRef = { readonly current: HTMLAudioElement | null };
type ElementRef = { readonly current: HTMLElement | null };

const peakCache = new Map<string, Promise<number[]>>();

export function waveform(seedText: string, count: number): number[] {
  let seed = 0;
  for (const char of seedText) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  return Array.from({ length: count }, (_, index) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const wave = Math.sin((index / count) * Math.PI);
    const noise = (seed % 1000) / 1000;
    return 26 + wave * 48 + noise * 26;
  });
}

function resample(peaks: number[], count: number): number[] {
  if (peaks.length === count) return peaks;
  const output: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((index * peaks.length) / count);
    const end = Math.max(start + 1, Math.floor(((index + 1) * peaks.length) / count));
    let value = 0;
    for (let i = start; i < end; i += 1) value = Math.max(value, peaks[i]);
    output.push(value);
  }
  return output;
}

function peaksFor(
  projectId: string,
  nodeId: string,
  candidate: Pick<AudioCandidate, 'id' | 'peaks'>,
): Promise<number[]> {
  if (Array.isArray(candidate.peaks) && candidate.peaks.length) {
    return Promise.resolve(candidate.peaks);
  }
  const key = `${projectId}|${nodeId}|${candidate.id}`;
  const cached = peakCache.get(key);
  if (cached) return cached;

  const task = (async () => {
    const query = `candidateId=${encodeURIComponent(candidate.id)}`;
    const data = await api<{ peaks?: number[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/audio/nodes/${encodeURIComponent(nodeId)}/peaks?${query}`,
    );
    return Array.isArray(data.peaks) ? data.peaks : [];
  })().catch(() => {
    peakCache.delete(key);
    return [];
  });

  peakCache.set(key, task);
  return task;
}

export function useWaveform(
  candidate: AudioCandidate | null,
  projectId: string | null,
  nodeId: string,
  count: number,
  seed: string,
): number[] {
  const [peaks, setPeaks] = useState<number[]>([]);
  const candidateId = candidate?.id || '';
  const inline = candidate?.peaks?.length ? candidate.peaks : null;

  useEffect(() => {
    let alive = true;
    setPeaks([]);
    if (!candidateId) return () => { alive = false; };
    if (inline) {
      setPeaks(inline);
      return () => { alive = false; };
    }
    if (!projectId) return () => { alive = false; };
    void peaksFor(projectId, nodeId, { id: candidateId }).then((value) => {
      if (alive && value.length) setPeaks(value);
    });
    return () => { alive = false; };
  }, [candidateId, inline, projectId, nodeId]);

  return useMemo(() => {
    if (!peaks.length) return waveform(seed, count);
    return resample(peaks, count).map((value) => 14 + value * 86);
  }, [peaks, count, seed]);
}

export function useAudioProgress(options: {
  audioRef: AudioRef;
  trackRef: ElementRef;
  timeRef: ElementRef;
  duration: number;
  playing: boolean;
  showTotal?: boolean;
}): () => void {
  const { audioRef, trackRef, timeRef, duration, playing, showTotal = true } = options;

  const paint = useCallback(() => {
    const audio = audioRef.current;
    const track = trackRef.current;
    if (!audio) return;
    const total =
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
    const ratio = total > 0 ? Math.min(1, Math.max(0, audio.currentTime / total)) : 0;
    track?.style.setProperty('--audio-progress', `${(ratio * 100).toFixed(3)}%`);
    if (timeRef.current && total > 0) {
      timeRef.current.textContent = showTotal
        ? `${clock(audio.currentTime)} / ${clock(total)}`
        : clock(audio.currentTime);
    }
  }, [audioRef, trackRef, timeRef, duration, showTotal]);

  useEffect(() => {
    if (!playing) {
      paint();
      return;
    }
    let raf = 0;
    const tick = () => {
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, paint]);

  return paint;
}
