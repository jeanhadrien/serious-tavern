import { describe, expect, it } from 'vitest';
import { presetSchema } from './preset.js';

const base = () => ({ id: 'e305f530-421a-492b-9d25-fbb054f28c04', name: 'Test', createdAt: '', updatedAt: '',
  entries: [
    { id: 'slot', kind: 'slot', enabled: true, name: 'Chat', key: 'history', dataType: 'messages' },
    { id: 'inject', kind: 'message', enabled: true, name: 'Note', role: 'system', content: 'Remember',
      placement: { mode: 'depth', slot: 'history', depth: 0 } }
  ] });
describe('preset schema', () => {
  it('defaults text slot role and ordered placement', () => {
    const parsed = presetSchema.parse({ ...base(), entries: [
      { id: 'slot', kind: 'slot', enabled: true, name: 'Input', key: 'input', dataType: 'text' },
      { id: 'msg', kind: 'message', enabled: true, name: 'Hello', role: 'user', content: 'Hi' }
    ] });
    expect(parsed.entries).toMatchObject([{ role: 'user' }, { placement: { mode: 'ordered' } }]);
  });
  it('rejects duplicate and malformed slot keys, duplicate ids', () => {
    const duplicate = { ...base(), entries: [...base().entries,
      { id: 'slot', kind: 'slot', enabled: false, name: 'Dup', key: 'history', dataType: 'text' }] };
    const issues = presetSchema.safeParse(duplicate);
    expect(issues.success).toBe(false);
    if (!issues.success) expect(issues.error.issues.map(issue => issue.message).join(' ')).toMatch(/Duplicate entry id.*Duplicate slot key/);
    expect(presetSchema.safeParse({ ...base(), entries: [
      { id: 'x', kind: 'slot', enabled: true, name: 'Bad', key: 'Bad-key', dataType: 'text' }
    ] }).success).toBe(false);
  });
  it('rejects depth references to missing, disabled and text slots and negative depths', () => {
    for (const replacement of [[], [{ ...base().entries[0], enabled: false }],
      [{ ...base().entries[0], dataType: 'text' }]]) {
      const result = presetSchema.safeParse({ ...base(), entries: [...replacement, base().entries[1]] });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.message).toContain('enabled messages slot');
    }
    expect(presetSchema.safeParse({ ...base(), entries: [
      base().entries[0], { ...base().entries[1], placement: { mode: 'depth', slot: 'history', depth: -1 } }
    ] }).success).toBe(false);
  });
});
