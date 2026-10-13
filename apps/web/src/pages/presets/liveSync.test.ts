import { expect, it } from 'vitest';
import { presetSchema, type Preset, type PresetEntry } from '@st/shared';
import { classifyDiskChange, planInvalidFileAlerts, reselectEntryId } from './liveSync.js';

const message = (id: string, content = 'Hi'): PresetEntry => ({
  id,
  displayName: id,
  kind: 'message',
  enabled: true,
  role: 'system',
  content,
  placement: { mode: 'ordered' },
});
const preset = (content = 'Hi'): Preset =>
  presetSchema.parse({
    id: '8f1fe1a9-3480-4e52-834c-f25d90684d71',
    name: 'Main',
    inputs: [],
    entries: [message('entry-1', content), message('entry-2')],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
const editorOf = (loaded: Preset, edit?: (draft: Preset) => Preset) => {
  const draft = structuredClone(loaded);
  return { draft: edit ? edit(draft) : draft, saved: JSON.stringify(loaded) };
};

it('treats identical disk content as a no-op, including a UI save followed by its own event', () => {
  const loaded = preset();
  expect(classifyDiskChange(editorOf(loaded), [structuredClone(loaded)])).toEqual({ kind: 'unchanged' });
  // Dirty editor, disk still at the version the draft started from.
  const dirty = editorOf(loaded, (draft) => ({ ...draft, name: 'Edited' }));
  expect(classifyDiskChange(dirty, [structuredClone(loaded)])).toEqual({ kind: 'unchanged' });
  expect(classifyDiskChange({ saved: '' }, [loaded])).toEqual({ kind: 'unchanged' });
});

it('reloads a clean editor when the file differs', () => {
  const disk = preset('Changed on disk');
  expect(classifyDiskChange(editorOf(preset()), [disk])).toEqual({ kind: 'reload', preset: disk });
});

it('closes a clean editor when the preset is gone', () => {
  expect(classifyDiskChange(editorOf(preset()), [])).toEqual({ kind: 'removed' });
});

it('never reloads a dirty editor and identifies the disk version for one-time warnings', () => {
  const dirty = editorOf(preset(), (draft) => ({ ...draft, name: 'Edited' }));
  const first = classifyDiskChange(dirty, [preset('A')]);
  const again = classifyDiskChange(dirty, [preset('A')]);
  const other = classifyDiskChange(dirty, [preset('B')]);
  expect(first).toMatchObject({ kind: 'conflict', removed: false });
  expect(again).toEqual(first);
  expect(other).not.toEqual(first);
  expect(classifyDiskChange(dirty, [])).toMatchObject({ kind: 'conflict', removed: true });
});

it('reselects the entry by position, because ids are re-derived', () => {
  const old = [message('uuid-a'), message('uuid-b'), message('uuid-c')];
  const next = [message('entry-1'), message('entry-2'), message('entry-3')];
  expect(reselectEntryId(old, 'uuid-b', next)).toBe('entry-2');
  // The entry list shrank: the last entry is the closest.
  expect(reselectEntryId(old, 'uuid-c', next.slice(0, 2))).toBe('entry-2');
  // Unknown selection or nothing left.
  expect(reselectEntryId(old, 'gone', next)).toBe('entry-1');
  expect(reselectEntryId(old, 'uuid-a', [])).toBe('');
});

it('plans invalid-file warnings once per (file, reason) and clears fixed files', () => {
  const broken = { file: 'a.yaml', reason: 'bad YAML' };
  expect(planInvalidFileAlerts(new Map(), [broken])).toEqual({ show: [broken], clear: [] });
  const shown = new Map([['a.yaml', 'bad YAML']]);
  expect(planInvalidFileAlerts(shown, [broken])).toEqual({ show: [], clear: [] });
  expect(planInvalidFileAlerts(shown, [])).toEqual({ show: [], clear: ['a.yaml'] });
  const reworded = { file: 'a.yaml', reason: 'missing name' };
  expect(planInvalidFileAlerts(shown, [reworded])).toEqual({ show: [reworded], clear: ['a.yaml'] });
});
