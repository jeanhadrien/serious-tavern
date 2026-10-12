import { expect, it } from 'vitest';
import { presetSchema, type Preset, type PresetSource } from '@st/shared';
import { copyPresetBody, importedNotice, isImportedPreset } from './presetImport.js';

const source: PresetSource = {
  app: 'sillytavern',
  installPath: '/st',
  user: 'default-user',
  file: 'Main.json',
  hash: 'a'.repeat(64),
  importedAt: '',
};

const imported = (): Preset =>
  presetSchema.parse({
    id: '8f1fe1a9-3480-4e52-834c-f25d90684d71',
    name: 'Main',
    description: 'From ST',
    inputs: [
      { id: 'history-id', key: 'history', dataType: 'messages' },
      { id: 'message-id', key: 'message', dataType: 'text' },
    ],
    entries: [
      {
        id: 'system',
        name: 'System',
        kind: 'message',
        enabled: true,
        role: 'system',
        content: 'Hi',
        placement: { mode: 'ordered' },
      },
      { id: 'history-slot', name: 'History', kind: 'slot', enabled: true, inputKey: 'history', role: 'user' },
      {
        id: 'depth',
        name: 'Depth note',
        kind: 'message',
        enabled: true,
        role: 'system',
        content: '{{input.message}}',
        placement: { mode: 'depth', entryId: 'history-slot', depth: 1 },
      },
    ],
    source,
    createdAt: '',
    updatedAt: '',
  });

it('treats only presets with a source as imported', () => {
  expect(isImportedPreset(imported())).toBe(true);
  expect(isImportedPreset({ source: undefined })).toBe(false);
});

it('explains where an imported preset came from', () => {
  const notice = importedNotice(source);
  expect(notice).toContain('SillyTavern');
  expect(notice).toContain('default-user');
  expect(notice).toContain('Main.json');
  expect(notice).not.toContain('no longer exists');
  expect(importedNotice({ ...source, missing: true })).toContain('no longer exists');
});

it('builds an editable duplicate body without the source and with fresh ids', () => {
  const original = imported();
  const body = copyPresetBody(original);
  expect(body).not.toHaveProperty('source');
  expect(body).not.toHaveProperty('id');
  expect(body.name).toBe('Main copy');
  expect(body.description).toBe('From ST');
  const entryIds = body.entries.map((entry) => entry.id);
  expect(entryIds).not.toContain('system');
  const depth = body.entries[2];
  expect(depth?.kind === 'message' && depth.placement?.mode === 'depth' && depth.placement.entryId).toBe(entryIds[1]);
  expect(body.inputs.map((input) => input.id)).not.toContain('history-id');
  expect(presetSchema.safeParse({ ...body, id: crypto.randomUUID(), createdAt: '', updatedAt: '' }).success).toBe(true);
});
