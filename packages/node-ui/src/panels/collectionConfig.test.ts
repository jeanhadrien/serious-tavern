import { expect, it } from 'vitest';
import {
  addId,
  escapeSeparator,
  formatList,
  moveId,
  parseCount,
  parseList,
  pickerRows,
  removeId,
  unescapeSeparator,
} from './collectionConfig.js';

it('reads and writes comma-separated lists', () => {
  expect(parseList(' forest, sea ,, ')).toEqual(['forest', 'sea']);
  expect(parseList('')).toEqual([]);
  expect(formatList(['forest', 'sea'])).toBe('forest, sea');
  expect(formatList(undefined)).toBe('');
});

it('shows separators on one line and reads them back', () => {
  for (const [stored, shown] of [
    ['\n\n', '\\n\\n'],
    ['\t', '\\t'],
    [' | ', ' | '],
    ['a\\b', 'a\\\\b'],
    ['\\n', '\\\\n'],
  ]) {
    expect(escapeSeparator(stored!)).toBe(shown);
    expect(unescapeSeparator(shown!)).toBe(stored);
  }
  expect(unescapeSeparator('\\x')).toBe('\\x');
});

it('accepts whole numbers from the minimum only', () => {
  expect(parseCount('3', 1)).toBe(3);
  expect(parseCount(' 0 ', 0)).toBe(0);
  for (const text of ['', '0', '-1', '1.5', 'x']) expect(parseCount(text, 1)).toBeUndefined();
});

it('names picked collections in order and flags unknown ids', () => {
  const catalog = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ];
  expect(pickerRows(['b', 'gone', 'a'], catalog)).toEqual([
    { id: 'b', name: 'Beta', known: true },
    { id: 'gone', name: 'Unknown collection (gone)', known: false },
    { id: 'a', name: 'Alpha', known: true },
  ]);
  expect(pickerRows(undefined, catalog)).toEqual([]);
  // A repeated id shows once (first wins), so rows keep unique keys.
  expect(pickerRows(['a', 'b', 'a'], catalog).map((row) => row.id)).toEqual(['a', 'b']);
});

it('adds, removes and moves ids', () => {
  expect(addId(['a'], 'b')).toEqual(['a', 'b']);
  expect(addId(['a'], 'a')).toEqual(['a']);
  expect(removeId(['a', 'b'], 'a')).toEqual(['b']);
  expect(moveId(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
  expect(moveId(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  expect(moveId(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
});
