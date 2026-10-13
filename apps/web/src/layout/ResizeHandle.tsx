import type { KeyboardEvent, PointerEvent } from 'react';
import { KEY_STEP } from './widths.js';

interface ResizeHandleProps {
  label: string;
  /** Current width of the column this handle resizes. */
  value: number;
  /** +1 when dragging right grows the column (L), -1 when it shrinks it (R). */
  direction: 1 | -1;
  area: string;
  onResize: (width: number) => void;
}

/** A draggable (and keyboard-operable) divider between two columns. */
export function ResizeHandle({ label, value, direction, area, onResize }: ResizeHandleProps) {
  const start = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const originX = event.clientX;
    const originWidth = value;
    const move = (moved: globalThis.PointerEvent) => onResize(originWidth + direction * (moved.clientX - originX));
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
    const step = event.key === 'ArrowLeft' ? -KEY_STEP : event.key === 'ArrowRight' ? KEY_STEP : 0;
    if (!step) return;
    event.preventDefault();
    onResize(value + direction * step);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable separator has no native element
    <div
      className="resize-handle"
      style={{ gridArea: area }}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={key}
    />
  );
}
