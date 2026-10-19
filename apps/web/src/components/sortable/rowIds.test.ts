import { describe, expect, it } from 'vitest';
import { fitIds, newRowId } from './rowIds.js';

describe('fitIds', () => {
  let n = 0;
  const make = () => `new${++n}`;

  it('keeps ids when the length matches', () => {
    expect(fitIds(['a', 'b'], 2, make)).toEqual(['a', 'b']);
  });

  it('makes ids for added rows and drops ids of removed ones from the end', () => {
    expect(fitIds(['a'], 3, make)).toEqual(['a', 'new1', 'new2']);
    expect(fitIds(['a', 'b', 'c'], 1, make)).toEqual(['a']);
    expect(fitIds(['a'], 0, make)).toEqual([]);
  });

  it('does not change its input', () => {
    const ids = ['a', 'b'];
    fitIds(ids, 1, make);
    expect(ids).toEqual(['a', 'b']);
  });

  it('makes distinct ids by default', () => {
    expect(newRowId()).not.toBe(newRowId());
  });
});
