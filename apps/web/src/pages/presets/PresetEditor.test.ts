import { expect, it } from 'vitest';
import { presetSchema, type PresetEntry } from '@st/shared';
import { entryIcon, entryPreview, reorderEntries } from './PresetEntryList.js';

const preset = presetSchema.parse({
  id: '8f1fe1a9-3480-4e52-834c-f25d90684d71',
  name: 'Test',
  inputs: [{ id: 'history-id', key: 'history', dataType: 'messages' }],
  entries: [],
  createdAt: '',
  updatedAt: '',
});

it('shows slot previews and a messages-slot icon', () => {
  const slot: PresetEntry = {
    id: 'history-slot',
    name: 'History',
    kind: 'slot',
    enabled: true,
    inputKey: 'history',
    role: 'user',
  };
  expect(entryPreview(slot)).toBe('→ {{input.history}}');
  expect(entryIcon(slot, preset)).toBe('📜');
});

it('previews compact entry content and uses the role icon', () => {
  const message: PresetEntry = {
    id: 'system',
    name: 'System',
    kind: 'message',
    enabled: true,
    role: 'assistant',
    content: 'Hello\nthere',
    placement: { mode: 'ordered' },
  };
  expect(entryPreview(message)).toBe('Hello there');
  expect(entryIcon(message, preset)).toBe('🤖');
});

const reorderFixture = () =>
  ['a', 'b', 'c'].map(
    (key): PresetEntry => ({
      id: key,
      name: key,
      kind: 'slot',
      enabled: true,
      inputKey: key,
      role: 'user',
    }),
  );

it('moves entries before or after the drop target', () => {
  expect(reorderEntries(reorderFixture(), 'c', 'a', false).map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
  expect(reorderEntries(reorderFixture(), 'a', 'c', true).map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  expect(reorderEntries(reorderFixture(), 'a', null, false).map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
});

it('leaves the order unchanged for unknown or self drops', () => {
  const entries = reorderFixture();
  expect(reorderEntries(entries, 'missing', 'a', false)).toBe(entries);
  expect(reorderEntries(entries, 'a', 'missing', false)).toBe(entries);
  expect(reorderEntries(entries, 'b', 'b', false)).toBe(entries);
});
