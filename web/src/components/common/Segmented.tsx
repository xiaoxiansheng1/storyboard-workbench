import { useEffect, useLayoutEffect, useRef } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import styles from './Segmented.module.css';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  disabled,
  block,
  compact,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  disabled?: boolean;
  block?: boolean;
  compact?: boolean;
  onChange: (value: T) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<Box | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const paintedRef = useRef(false);
  const placeRef = useRef<(animate: boolean) => void>(() => {});

  useLayoutEffect(() => {
    const root = rootRef.current;
    const indicator = indicatorRef.current;
    if (!root || !indicator) return;

    const place = (animate: boolean) => {
      const active = root.querySelector<HTMLElement>('[data-state="on"]');
      if (!active) {
        indicator.style.opacity = '0';
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const rect = active.getBoundingClientRect();
      const next: Box = {
        x: rect.left - rootRect.left - root.clientLeft,
        y: rect.top - rootRect.top - root.clientTop,
        w: rect.width,
        h: rect.height,
      };
      const prev = boxRef.current;
      boxRef.current = next;

      animationRef.current?.cancel();
      animationRef.current = null;
      indicator.style.width = `${next.w}px`;
      indicator.style.height = `${next.h}px`;
      indicator.style.transform = `translate(${next.x}px, ${next.y}px)`;
      indicator.style.opacity = '1';

      if (
        animate &&
        prev &&
        (prev.x !== next.x || prev.y !== next.y || prev.w !== next.w || prev.h !== next.h)
      ) {
        animationRef.current = indicator.animate(
          [
            {
              width: `${prev.w}px`,
              height: `${prev.h}px`,
              transform: `translate(${prev.x}px, ${prev.y}px)`,
            },
            {
              width: `${next.w}px`,
              height: `${next.h}px`,
              transform: `translate(${next.x}px, ${next.y}px)`,
            },
          ],
          { duration: 240, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
        );
      }
    };

    placeRef.current = place;
    place(paintedRef.current);
    paintedRef.current = true;

    return () => {
      animationRef.current?.cancel();
      animationRef.current = null;
    };
  }, [value, options.length, disabled]);

  // 观察器只建一次：若随 value 重建，它的首次回调会立刻取消刚启动的滑动动画
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => placeRef.current(false));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <ToggleGroup.Root
      ref={rootRef}
      type="single"
      className={`${styles.root}${block ? ` ${styles.block}` : ''}${compact ? ` ${styles.compact}` : ''}`}
      value={String(value)}
      disabled={disabled}
      aria-label={label}
      onValueChange={(next) => {
        if (!next) return;
        const option = options.find((item) => String(item.value) === next);
        if (option) onChange(option.value);
      }}
    >
      <span ref={indicatorRef} className={styles.indicator} aria-hidden="true" />
      {options.map((option) => (
        <ToggleGroup.Item key={option.value} value={String(option.value)} className={styles.item}>
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
