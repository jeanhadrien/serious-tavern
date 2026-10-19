import { describe, expect, it } from 'vitest';
import { moveItem } from './moveItem.js';

describe('moveItem', () => {
  it.each([
    [0, 1, ['b', 'a', 'c']],
    [0, 2, ['b', 'c', 'a']],
    [2, 0, ['c', 'a', 'b']],
    [1, 0, ['b', 'a', 'c']],
    [2, 1, ['a', 'c', 'b']],
    [1, 1, ['a', 'b', 'c']],
    [-1, 1, ['a', 'b', 'c']],
    [0, -1, ['a', 'b', 'c']],
    [3, 0, ['a', 'b', 'c']],
    [0, 3, ['a', 'b', 'c']],
    [0.5, 1, ['a', 'b', 'c']],
  ])('moves %i to %i', (from, to, expected) => {
    expect(moveItem(['a', 'b', 'c'], from, to)).toEqual(expected);
  });

  it('returns a new array and leaves the input alone', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 0, 1)).not.toBe(list);
    expect(moveItem(list, 0, 0)).not.toBe(list);
    expect(list).toEqual(['a', 'b']);
  });

  it('handles an empty list', () => {
    expect(moveItem([], 0, 1)).toEqual([]);
  });
});
