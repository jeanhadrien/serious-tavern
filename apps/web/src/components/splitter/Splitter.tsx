import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import './splitter.css';

export interface SplitterProps {
  /** Names the splitter for assistive technology ("Resize chat panel"). */
  label: string;
  /** Current size, in pixels, of the pane this splitter resizes. */
  value: number;
  onChange(next: number): void;
  /** Called on a double-click: back to the default size. */
  onReset?(): void;
  /** `vertical` is a vertical bar that moves left and right; `horizontal` moves up and down. */
  orientation?: 'vertical' | 'horizontal';
  /** +1 when dragging right (or down) grows the pane, -1 when it shrinks it. */
  direction?: 1 | -1;
  /** Pixels moved by one arrow key press. */
  step?: number;
  /** For assistive technology only; the owner of the size clamps. */
  min?: number;
  max?: number;
  className?: string;
  style?: CSSProperties;
}

const KEYS = {
  vertical: { ArrowLeft: -1, ArrowRight: 1 },
  horizontal: { ArrowUp: -1, ArrowDown: 1 },
} as const;

/**
 * A draggable divider that is also operable by keyboard (arrows) and resets on a double-click. It owns no size: the
 * caller keeps `value` (usually through `useStoredSize`) and clamps what `onChange` hands it.
 */
export function Splitter({
  label,
  value,
  onChange,
  onReset,
  orientation = 'vertical',
  direction = 1,
  step = 16,
  min,
  max,
  className,
  style,
}: SplitterProps) {
  const vertical = orientation === 'vertical';
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const origin = vertical ? event.clientX : event.clientY;
    const originValue = value;
    const move = (moved: globalThis.PointerEvent) =>
      onChange(originValue + direction * ((vertical ? moved.clientX : moved.clientY) - origin));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    // Alt+arrows move sortable rows and Mod+arrows belong to the browser: the splitter takes the plain arrows only.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const sign = (KEYS[orientation] as Record<string, number>)[event.key];
    if (!sign) return;
    event.preventDefault();
    onChange(value + direction * sign * step);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable separator has no native element
    <div
      className={className ? `splitter ${className}` : 'splitter'}
      data-orientation={orientation}
      style={style}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={key}
      onDoubleClick={onReset}
    />
  );
}
