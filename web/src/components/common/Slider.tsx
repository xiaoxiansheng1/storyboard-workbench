import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import styles from './Slider.module.css';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  keyStep?: number;
  label: string;
  disabled?: boolean;
  className?: string;
  formatValue?: (value: number) => string;
  onChange: (value: number) => void;
}

function round(value: number, step: number): number {
  const precision = Math.max(0, -Math.floor(Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(precision));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function Slider({
  value,
  min,
  max,
  step = 0.01,
  keyStep,
  label,
  disabled,
  className,
  formatValue,
  onChange,
}: SliderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ratio = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
  const keyboard = keyStep ?? step;

  const setAt = (clientX: number) => {
    const element = rootRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const next = clamp(min + ((clientX - rect.left) / rect.width) * (max - min), min, max);
    onChange(round(next, step));
  };

  const nudge = (delta: number) => {
    const next = clamp(round(value + delta, step), min, max);
    if (next !== value) onChange(next);
  };

  return (
    <div
      ref={rootRef}
      className={`${styles.root}${className ? ` ${className}` : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={formatValue ? formatValue(value) : undefined}
      aria-disabled={disabled || undefined}
      style={{ '--ratio': ratio.toFixed(4) } as CSSProperties}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setAt(event.clientX);
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        if (disabled) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setAt(event.clientX);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nudge(-keyboard);
        else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nudge(keyboard);
        else if (event.key === 'PageDown') nudge(-keyboard * 10);
        else if (event.key === 'PageUp') nudge(keyboard * 10);
        else if (event.key === 'Home') nudge(min - value);
        else if (event.key === 'End') nudge(max - value);
        else return;
        event.preventDefault();
      }}
    >
      <span className={styles.track} aria-hidden="true" />
      <span className={styles.fill} aria-hidden="true" />
      <span className={styles.thumb} aria-hidden="true" />
    </div>
  );
}
