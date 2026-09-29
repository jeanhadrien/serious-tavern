import { expect, it } from 'vitest';
import { presetSchema, type PresetEntry } from '@st/shared';
import { entryIcon, entryPreview } from './PresetEditor.js';

const preset = presetSchema.parse({
  id: '8f1fe1a9-3480-4e52-834c-f25d90684d71', name: 'Test',
  inputs: [{ id: 'history-id', key: 'history', dataType: 'messages' }],
  entries: [], createdAt: '', updatedAt: ''
});

it('shows slot previews and a messages-slot icon', () => {
  const slot: PresetEntry = {
    id: 'history-slot', name: 'History', kind: 'slot', enabled: true, inputKey: 'history', role: 'user'
  };
  expect(entryPreview(slot)).toBe('→ {{input.history}}');
  expect(entryIcon(slot, preset)).toBe('📜');
});

it('previews compact entry content and uses the role icon', () => {
  const message: PresetEntry = {
    id: 'system', name: 'System', kind: 'message', enabled: true, role: 'assistant', content: 'Hello\nthere',
    placement: { mode: 'ordered' }
  };
  expect(entryPreview(message)).toBe('Hello there');
  expect(entryIcon(message, preset)).toBe('🤖');
});
