import { expect, it } from 'vitest';
import { sparklinePoints } from './sparklinePoints.js';

const history = (...pairs: [number, unknown][]) => pairs.map(([turn, value]) => ({ turn, value }));

it('places ascending values from bottom left to top right', () => {
  expect(sparklinePoints(history([1, 0], [2, 5], [3, 10]))).toEqual({
    points: '2,18 36,10 70,2',
    last: { x: 70, y: 2 },
    min: 0,
    max: 10,
    values: [0, 5, 10],
  });
});

it('inverts the y axis for descending values', () => {
  expect(sparklinePoints(history([1, 10], [2, 0]))?.points).toBe('2,2 70,18');
});

it('draws a flat series at mid height', () => {
  expect(sparklinePoints(history([1, 4], [2, 4], [3, 4]))).toMatchObject({
    points: '2,10 36,10 70,10',
    min: 4,
    max: 4,
  });
});

it('draws nothing for a single point: a line needs two', () => {
  expect(sparklinePoints(history([7, 3]))).toBeUndefined();
  expect(sparklinePoints(history([1, 'x'], [2, 5]))).toBeUndefined();
});

it('spaces points by turn number, not by position', () => {
  const xs = sparklinePoints(history([1, 0], [2, 1], [10, 2]))
    ?.points.split(' ')
    .map((point) => Number(point.split(',')[0]));
  expect(xs).toEqual([2, 9.6, 70]);
});

it('ignores points without a finite number', () => {
  expect(
    sparklinePoints(history([1, 'calm'], [2, undefined], [3, Number.NaN], [4, Number.POSITIVE_INFINITY])),
  ).toBeUndefined();
  expect(sparklinePoints(history([1, 'x'], [2, 5], [3, null], [4, 7]))?.points).toBe('2,18 70,2');
  expect(sparklinePoints([{ turn: 1 }, { turn: 2 }])).toBeUndefined();
});

it('draws nothing for an empty history', () => {
  expect(sparklinePoints([])).toBeUndefined();
});

it('keeps every point of a long history inside the box, to one decimal', () => {
  const long = history(...Array.from({ length: 100 }, (_, i): [number, number] => [i + 1, Math.sin(i) * 7]));
  const result = sparklinePoints(long);
  const points = result?.points.split(' ').map((point) => point.split(',').map(Number)) ?? [];
  expect(points).toHaveLength(100);
  for (const [x = -1, y = -1] of points) {
    expect(x).toBeGreaterThanOrEqual(2);
    expect(x).toBeLessThanOrEqual(70);
    expect(y).toBeGreaterThanOrEqual(2);
    expect(y).toBeLessThanOrEqual(18);
    expect(Math.round(x * 10) / 10).toBe(x);
    expect(Math.round(y * 10) / 10).toBe(y);
  }
});

it('honours another size', () => {
  expect(sparklinePoints(history([1, 0], [2, 1]), { width: 10, height: 10, pad: 0 })?.points).toBe('0,10 10,0');
});
