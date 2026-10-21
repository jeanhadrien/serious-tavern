import { describe, expect, it } from 'vitest';
import type { NodeTypeDescriptor } from '@st/shared';
import { compareTypes, groupByCategory } from './nodeTypeOrder.js';

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

describe('groupByCategory', () => {
  const descriptor = (category: string, label: string) => ({ type: label, category, label }) as NodeTypeDescriptor;
  it('groups by category in order, each group sorted by label', () => {
    const groups = groupByCategory([
      descriptor('Logic', 'Merge'),
      descriptor('AI', 'LLM'),
      descriptor('Logic', 'Condition'),
      descriptor('Chat', 'Output'),
      descriptor('Chat', 'Input'),
    ]);
    expect(groups.map((g) => [g.category, g.types.map((t) => t.label)])).toEqual([
      ['AI', ['LLM']],
      ['Chat', ['Input', 'Output']],
      ['Logic', ['Condition', 'Merge']],
    ]);
  });
  it('is empty for no types', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});
