import { expect, it } from 'vitest';
import { compareRecent } from './recentOrder.js';

const item = (updatedAt: string, createdAt: string, name: string) => ({ updatedAt, createdAt, name });

it('orders by updatedAt desc, then createdAt desc, then name ascending', () => {
  const list = [
    item('2024-01-02T00:00:00.000Z', '2024-01-01T00:00:00.000Z', 'aaa'),
    item('2024-01-03T00:00:00.000Z', '2024-01-01T00:00:00.000Z', 'zzz'),
    item('2024-01-03T00:00:00.000Z', '2024-01-02T00:00:00.000Z', 'mmm'),
    item('2024-01-03T00:00:00.000Z', '2024-01-02T00:00:00.000Z', 'abc'),
  ];
  const sorted = [...list].sort((a, b) => compareRecent(a, b, (entry) => entry.name));
  expect(sorted.map((entry) => entry.name)).toEqual(['abc', 'mmm', 'zzz', 'aaa']);
});

it('supports title-keyed lists such as chat sessions', () => {
  const list = [
    { updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z', title: 'b' },
    { updatedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z', title: 'a' },
  ];
  const sorted = [...list].sort((a, b) => compareRecent(a, b, (entry) => entry.title));
  expect(sorted.map((entry) => entry.title)).toEqual(['a', 'b']);
});
