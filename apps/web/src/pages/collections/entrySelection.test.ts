import { expect, it } from 'vitest';
import { selectionAfterLoad, selectionAfterMove, selectionAfterRemove } from './entrySelection.js';

it.each([
  [undefined, 1, undefined],
  [1, 1, undefined],
  [0, 1, 0],
  [3, 1, 2],
])('after removing entry %#: selected %j, removed %j → %j', (selected, removed, expected) => {
  expect(selectionAfterRemove(selected, removed)).toBe(expected);
});

it.each([
  [2, 2, 1, 1],
  [1, 2, 1, 2],
  [0, 2, 1, 0],
  [undefined, 2, 3, undefined],
  // Longer moves: the moved entry, the ones it passes, and the ones outside.
  [0, 0, 3, 3],
  [3, 0, 3, 2],
  [1, 0, 3, 0],
  [4, 0, 3, 4],
  [3, 3, 0, 0],
  [0, 3, 0, 1],
  [2, 3, 0, 3],
  [4, 3, 0, 4],
])('after a move %#: selected %j, %j → %j gives %j', (selected, from, to, expected) => {
  expect(selectionAfterMove(selected, from, to)).toBe(expected);
});

it.each([
  [2, 5, true, 2],
  [4, 2, true, 1],
  [0, 0, true, undefined],
  [undefined, 3, true, undefined],
  [1, 3, false, undefined],
])('after a load %#: selected %j, %j entries, keep %j → %j', (selected, length, keep, expected) => {
  expect(selectionAfterLoad(selected, length, keep)).toBe(expected);
});
