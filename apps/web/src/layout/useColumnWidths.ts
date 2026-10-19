import { useEffect, useState, type RefObject } from 'react';
import { fitWidths, loadWidths, resetSide, resizeSide, saveWidths, type ColumnWidths, type Side } from './widths.js';

/**
 * Side column widths for the shell: remembered in localStorage, fitted to the width of
 * `containerRef` (so a narrow window never squeezes M below its minimum) and resized
 * through `resize` (a double-click on a handle calls `reset`).
 */
export function useColumnWidths(containerRef: RefObject<HTMLElement | null>, columns: 2 | 3) {
  const [stored, setStored] = useState(loadWidths);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setTotal(element.clientWidth));
    observer.observe(element);
    setTotal(element.clientWidth);
    return () => observer.disconnect();
  }, [containerRef]);
  const widths = fitWidths(stored, total, columns);
  const commit = (next: ColumnWidths) => {
    setStored(next);
    saveWidths(next);
  };
  const resize = (side: Side, value: number) => commit(resizeSide(widths, side, value, total, columns));
  const reset = (side: Side) => commit(resetSide(widths, side, total, columns));
  return { widths, resize, reset };
}
