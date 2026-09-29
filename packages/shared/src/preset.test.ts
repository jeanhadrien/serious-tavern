import { describe, expect, it } from 'vitest';
import { presetSchema, presetWarnings } from './preset.js';

const base = () => ({
  id: 'e305f530-421a-492b-9d25-fbb054f28c04', name: 'Test', createdAt: '', updatedAt: '',
  inputs: [{ key: 'history', name: 'Chat', dataType: 'messages' as const },
    { key: 'message', name: 'Message', dataType: 'text' as const }],
  entries: [
    { id: 'history-entry', kind: 'input' as const, enabled: true, name: 'Chat', inputKey: 'history' },
    { id: 'inject', kind: 'message' as const, enabled: true, name: 'Note', role: 'system' as const, content: 'Remember',
      placement: { mode: 'depth' as const, inputKey: 'history', depth: 0 } },
    { id: 'message-entry', kind: 'input' as const, enabled: true, name: 'Message', inputKey: 'message' }
  ]
});
describe('preset schema', () => {
  it('defaults inputs and ordered placement and input role', () => {
    const parsed = presetSchema.parse({ ...base(), entries: [
      { id: 'input', kind: 'input', enabled: true, name: 'Input', inputKey: 'message' },
      { id: 'msg', kind: 'message', enabled: true, name: 'Hello', role: 'user', content: 'Hi' }
    ] });
    expect(parsed.inputs[0]?.enabled).toBe(true);
    expect(parsed.entries).toMatchObject([{ role: 'user' }, { placement: { mode: 'ordered' } }]);
    expect(presetSchema.parse({ ...base(), inputs: undefined, entries: [] }).inputs).toEqual([]);
  });
  it('rejects duplicate input keys and entry ids, malformed keys and unknown input references', () => {
    const duplicate = { ...base(), inputs: [...base().inputs, { key: 'history', name: 'Another', dataType: 'text' }] };
    const result = presetSchema.safeParse(duplicate);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(issue => issue.message).join(' '))
      .toMatch(/Duplicate input key/);
    expect(presetSchema.safeParse({ ...base(), entries: [
      ...base().entries, { id: 'inject', kind: 'input', enabled: false, name: 'Duplicate', inputKey: 'history' }
    ] }).success).toBe(false);
    expect(presetSchema.safeParse({ ...base(), inputs: [
      { key: 'Bad-key', name: 'Bad', dataType: 'text' }
    ] }).success).toBe(false);
    const unknown = presetSchema.safeParse({ ...base(), entries: [
      { id: 'unknown', kind: 'input', enabled: true, name: 'Missing', inputKey: 'missing' }
    ] });
    expect(unknown.success).toBe(false);
    if (!unknown.success) expect(unknown.error.issues[0]?.message).toContain('Unknown input');
  });
  it('rejects depth references without a placed enabled messages input and negative depths', () => {
    for (const replacement of [
      [{ ...base().inputs[0], enabled: false }],
      [{ ...base().inputs[0], dataType: 'text' as const }]
    ]) {
      const result = presetSchema.safeParse({ ...base(), inputs: replacement,
        entries: [base().entries[0], base().entries[1]] });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map(issue => issue.message).join(' '))
        .toContain('enabled messages input');
    }
    expect(presetSchema.safeParse({ ...base(), entries: [
      base().entries[0], { ...base().entries[1], placement: { mode: 'depth', inputKey: 'history', depth: -1 } }
    ] }).success).toBe(false);
    expect(presetSchema.safeParse({ ...base(), entries: [
      { ...base().entries[0], enabled: false }, base().entries[1]
    ] }).success).toBe(false);
  });
});

it('reports unused enabled inputs and missing template input references', () => {
  const parsed = presetSchema.parse({ ...base(), entries: [
    { id: 'message', kind: 'message', enabled: true, name: 'System', role: 'system',
      content: '{{input.missing}} {{input.message}}' }
  ] });
  expect(presetWarnings(parsed)).toEqual([
    'Input "history" is enabled but is not placed in the message list.',
    'Input "message" is enabled but is not placed in the message list.',
    'Message "System" references unavailable input "missing".'
  ]);
});
