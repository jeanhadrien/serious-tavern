import { describe, expect, it } from 'vitest';
import { compareTypes } from './nodeTypeOrder.js';

const type = (category: string, label: string) => ({ category, label });
const sorted = (list: { category: string; label: string }[]) =>
  [...list].sort(compareTypes).map((item) => `${item.category}/${item.label}`);

describe('compareTypes', () => {
  it.each([
    ['category first', [type('B', 'Alpha'), type('A', 'Zed')], ['A/Zed', 'B/Alpha']],
    ['then label', [type('A', 'Zed'), type('A', 'Alpha')], ['A/Alpha', 'A/Zed']],
    ['and is stable for equal entries', [type('A', 'x'), type('A', 'x')], ['A/x', 'A/x']],
  ])('%s', (_, list, expected) => {
    expect(sorted(list)).toEqual(expected);
  });
});
