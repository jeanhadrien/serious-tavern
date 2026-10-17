import { expect, it } from 'vitest';
import { formatValue, shortText } from './format.js';

it('collapses whitespace and cuts with an ellipsis only when too long', () => {
  expect(shortText('  a   bell\non\ta lost animal ', 40)).toBe('a bell on a lost animal');
  expect(shortText('abcdef', 6)).toBe('abcdef');
  expect(shortText('abcdefg', 6)).toBe('abcde…');
  expect(shortText('ab cdefgh', 4)).toBe('ab…');
  expect(shortText('', 5)).toBe('');
  expect(shortText('abc', 0)).toBe('…');
});

it.each([
  [6, '6'],
  [-2.5, '-2.5'],
  [0, '0'],
  [true, 'true'],
  [false, 'false'],
  ['tense', 'tense'],
  ['', '(empty)'],
  ['   ', '(empty)'],
  [null, 'none'],
  [undefined, 'none'],
  [{ a: 1, b: ['x'] }, '{"a":1,"b":["x"]}'],
  [[], '[]'],
])('words %j as %s', (value, expected) => {
  expect(formatValue(value)).toBe(expected);
});

it('cuts a long object and survives values JSON cannot hold', () => {
  const long = formatValue({ text: 'x'.repeat(200) });
  expect(long).toHaveLength(60);
  expect(long.endsWith('…')).toBe(true);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(formatValue(circular)).toBe('none');
  expect(formatValue(() => 1)).toBe('none');
});
