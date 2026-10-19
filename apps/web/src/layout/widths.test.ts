import { expect, it } from 'vitest';
import {
  DEFAULT_WIDTHS,
  fitWidths,
  HANDLE_WIDTH,
  loadWidths,
  MIN_MIDDLE,
  MIN_SIDE,
  resetSide,
  resizeSide,
  saveWidths,
} from './widths.js';

it('keeps stored widths when everything fits and skips fitting before the size is known', () => {
  expect(fitWidths({ left: 260, right: 340 }, 1600, 3)).toEqual({ left: 260, right: 340 });
  expect(fitWidths({ left: 900, right: 900 }, 0, 3)).toEqual({ left: 900, right: 900 });
});

it('shrinks side columns so the middle keeps its minimum', () => {
  const fitted = fitWidths({ left: 600, right: 600 }, 1200, 3);
  expect(fitted.left + fitted.right + MIN_MIDDLE + 2 * HANDLE_WIDTH).toBeLessThanOrEqual(1200);
  expect(fitted.left).toBeGreaterThanOrEqual(MIN_SIDE);
  expect(fitted.right).toBeGreaterThanOrEqual(MIN_SIDE);
});

it('clamps a resized column between its minimum and what the others leave', () => {
  const widths = { left: 260, right: 340 };
  expect(resizeSide(widths, 'left', 10, 1600, 3).left).toBe(MIN_SIDE);
  expect(resizeSide(widths, 'left', 5000, 1600, 3)).toEqual({
    left: 1600 - MIN_MIDDLE - 2 * HANDLE_WIDTH - 340,
    right: 340,
  });
  expect(resizeSide(widths, 'right', 400.4, 1600, 3).right).toBe(400);
});

it('lets the left column use the whole budget in two-column mode', () => {
  expect(resizeSide(DEFAULT_WIDTHS, 'left', 5000, 1000, 2).left).toBe(1000 - MIN_MIDDLE - HANDLE_WIDTH);
});

it('resets one column to its default and leaves the other alone', () => {
  const widths = { left: 400, right: 500 };
  expect(resetSide(widths, 'left', 1600, 3)).toEqual({ left: DEFAULT_WIDTHS.left, right: 500 });
  expect(resetSide(widths, 'right', 1600, 3)).toEqual({ left: 400, right: DEFAULT_WIDTHS.right });
  // Still clamped when the other column leaves less room than the default.
  expect(resetSide({ left: 800, right: 180 }, 'right', 1500, 3).right).toBe(1500 - MIN_MIDDLE - 2 * HANDLE_WIDTH - 800);
});

it('round-trips widths through storage and survives broken storage', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  saveWidths({ left: 300, right: 400 }, storage);
  expect(loadWidths(storage)).toEqual({ left: 300, right: 400 });
  store.set('st.layout.widths', '{"left":"x"}');
  expect(loadWidths(storage)).toEqual(DEFAULT_WIDTHS);
  store.set('st.layout.widths', 'not json');
  expect(loadWidths(storage)).toEqual(DEFAULT_WIDTHS);
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  expect(loadWidths(throwing)).toEqual(DEFAULT_WIDTHS);
  expect(() => saveWidths(DEFAULT_WIDTHS, throwing)).not.toThrow();
});
