import { describe, expect, it } from 'vitest';
import { presetSchema, presetWarnings } from './preset.js';

const base = () => ({
  id: 'e305f530-421a-492b-9d25-fbb054f28c04', name: 'Test', createdAt: '', updatedAt: '',
  inputs: [
    { id: 'history-input', key: 'history', label: 'Chat history', dataType: 'messages' as const },
    { id: 'message-input', key: 'message', label: 'User message', dataType: 'text' as const }
  ],
  entries: [
    { id: 'history-slot', kind: 'slot' as const, enabled: true, name: 'History', inputKey: 'history' },
    { id: 'injection', kind: 'message' as const, enabled: true, name: 'Note', role: 'system' as const, content: 'Remember',
      placement: { mode: 'depth' as const, entryId: 'history-slot', depth: 0 } },
    { id: 'message-slot', kind: 'slot' as const, enabled: true, name: 'Message', inputKey: 'message' }
  ]
});

describe('preset schema', () => {
  it('parses ordered placement and defaults slot role', () => {
    const parsed = presetSchema.parse({ ...base(), entries: [
      { id: 'slot', kind: 'slot', enabled: true, name: 'Message', inputKey: 'message' },
      { id: 'message', kind: 'message', enabled: true, name: 'Hello', role: 'user', content: 'Hi' }
    ] });
    expect(parsed.entries).toMatchObject([{ role: 'user' }, { placement: { mode: 'ordered' } }]);
  });

  it('rejects invalid and duplicate input keys and duplicate entry ids at useful paths', () => {
    const duplicate = presetSchema.safeParse({ ...base(), inputs: [
      ...base().inputs, { id: 'other', key: 'history', dataType: 'text' }
    ] });
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) expect(duplicate.error.issues).toContainEqual(expect.objectContaining({
      path: ['inputs', 2, 'key'], message: 'Duplicate input key: history'
    }));
    expect(presetSchema.safeParse({ ...base(), inputs: [
      { id: 'bad', key: 'Bad-key', dataType: 'text' }
    ] }).success).toBe(false);
    const duplicateEntry = presetSchema.safeParse({ ...base(), entries: [
      ...base().entries, { ...base().entries[0], name: 'Again' }
    ] });
    expect(duplicateEntry.success).toBe(false);
    if (!duplicateEntry.success) expect(duplicateEntry.error.issues).toContainEqual(expect.objectContaining({
      path: ['entries', 3, 'id'], message: 'Duplicate entry id: history-slot'
    }));
  });

  it('rejects slots for unknown inputs', () => {
    const result = presetSchema.safeParse({ ...base(), entries: [
      { id: 'unknown', kind: 'slot', enabled: true, name: 'Missing', inputKey: 'missing' }
    ] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({
      path: ['entries', 0, 'inputKey'], message: 'Unknown input: missing'
    }));
  });

  it('rejects depth placements that do not point to an enabled messages slot', () => {
    for (const target of ['absent', 'message-slot', 'disabled-slot']) {
      const result = presetSchema.safeParse({ ...base(), entries: base().entries.map(entry =>
        entry.id === 'injection' ? { ...entry, placement: { mode: 'depth', entryId: target, depth: 0 } } : entry) });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some(issue =>
        issue.path.join('.') === 'entries.1.placement.entryId')).toBe(true);
    }
    const disabled = presetSchema.safeParse({ ...base(), entries: base().entries.map(entry =>
      entry.id === 'history-slot' ? { ...entry, enabled: false } : entry) });
    expect(disabled.success).toBe(false);
    const wrongType = presetSchema.safeParse({ ...base(),
      inputs: base().inputs.map(input => input.key === 'history' ? { ...input, dataType: 'text' as const } : input) });
    expect(wrongType.success).toBe(false);
    expect(presetSchema.safeParse({ ...base(), entries: base().entries.map(entry =>
      entry.id === 'injection' ? { ...entry, placement: { mode: 'depth', entryId: 'history-slot', depth: -1 } } : entry)
    }).success).toBe(false);
  });

  it('rejects unknown input template references on the content path', () => {
    const result = presetSchema.safeParse({ ...base(), entries: [
      { id: 'message', kind: 'message', enabled: true, name: 'System', role: 'system',
        content: '{{input.missing}} and {{input.Unknown}}' }
    ] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.filter(issue => issue.path.join('.') === 'entries.0.content'))
      .toHaveLength(2);
  });
});

it('warns when an input is unused by enabled slots or message templates', () => {
  const parsed = presetSchema.parse({ ...base(), entries: [
    { id: 'message', kind: 'message', enabled: true, name: 'System', role: 'system',
      content: 'Use {{input.message}}' },
    { id: 'disabled', kind: 'slot', enabled: false, name: 'Disabled slot', inputKey: 'history' }
  ] });
  expect(presetWarnings(parsed)).toEqual([
    { path: ['inputs', 0], message: 'Input "history" is not used by an enabled entry.' }
  ]);
});
