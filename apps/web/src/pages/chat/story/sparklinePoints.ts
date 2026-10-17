import type { HistoryPoint } from '@st/shared';

export interface SparklineSize {
  width: number;
  height: number;
  /** Space kept free around the line so the end dot is not cut off. */
  pad: number;
}
export const SPARKLINE_SIZE: SparklineSize = { width: 72, height: 20, pad: 2 };

export interface Sparkline {
  /** The `points` attribute of a polyline. */
  points: string;
  /** The newest point, drawn as a dot. */
  last: { x: number; y: number };
  min: number;
  max: number;
  /** The values drawn, oldest first (for the accessible description). */
  values: number[];
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * A key's numeric history as polyline points. Only points with a finite number count (text and object keys keep no
 * value); x is proportional to the turn number, y is inverted (a high value is near the top). One point is a
 * centred dot and a flat series runs at mid height. Undefined when nothing can be drawn.
 */
export function sparklinePoints(
  history: readonly HistoryPoint[],
  { width, height, pad }: SparklineSize = SPARKLINE_SIZE,
): Sparkline | undefined {
  const points = history.flatMap(({ turn, value }) =>
    typeof value === 'number' && Number.isFinite(value) && Number.isFinite(turn) ? [{ turn, value }] : [],
  );
  const first = points[0];
  const newest = points[points.length - 1];
  if (!first || !newest) return undefined;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const turns = newest.turn - first.turn;
  const x = (turn: number) => (turns > 0 ? pad + ((turn - first.turn) / turns) * (width - 2 * pad) : width / 2);
  const y = (value: number) => (max > min ? pad + ((max - value) / (max - min)) * (height - 2 * pad) : height / 2);
  const placed = points.map((point) => ({ x: round(x(point.turn)), y: round(y(point.value)) }));
  const last = placed[placed.length - 1] ?? { x: round(width / 2), y: round(height / 2) };
  return { points: placed.map((point) => `${point.x},${point.y}`).join(' '), last, min, max, values };
}
