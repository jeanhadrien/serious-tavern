import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Preset } from '@st/shared';
import { migrateJsonPresets } from './preset-migration.js';
import { PresetRepository } from './preset-repository.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'preset-migration-test-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

const date = '2026-01-01T00:00:00.000Z';
function legacyPreset(name: string): Preset {
  const slotId = randomUUID();
  return {
    id: randomUUID(),
    name,
    inputs: [{ id: randomUUID(), key: 'history', dataType: 'messages' }],
    entries: [
      {
        id: randomUUID(),
        name: 'Main',
        enabled: true,
        kind: 'message',
        role: 'system',
        content: '  {{char}}\n---\n# x\r\n',
        placement: { mode: 'ordered' },
      },
      {
        id: randomUUID(),
        name: 'Note',
        enabled: true,
        kind: 'message',
        role: 'system',
        content: 'n',
        placement: { mode: 'depth', entryId: slotId, depth: 1 },
      },
      { id: slotId, name: 'History', enabled: true, kind: 'slot', inputKey: 'history', role: 'user' },
    ],
    createdAt: date,
    updatedAt: date,
    unknownField: { keep: true },
  } as Preset;
}
const names = async () => (await readdir(directory)).sort();

it('migrates JSON presets to YAML, keeps the JSON as .json.migrated and is idempotent', async () => {
  const a = legacyPreset('Alpha');
  const b = legacyPreset('Beta');
  const jsonA = JSON.stringify(a, null, 2);
  await writeFile(join(directory, `${a.id}.json`), jsonA);
  await writeFile(join(directory, `${b.id}.json`), JSON.stringify(b));
  const repository = new PresetRepository(directory);
  await migrateJsonPresets(directory, repository);
  expect(await names()).toEqual(['alpha.yaml', `${a.id}.json.migrated`, `${b.id}.json.migrated`, 'beta.yaml'].sort());
  expect(await readFile(join(directory, `${a.id}.json.migrated`), 'utf8')).toBe(jsonA);
  const stored = await repository.get(a.id);
  expect(stored).toMatchObject({ name: 'Alpha', unknownField: { keep: true } });
  expect((stored!.entries[0] as { content: string }).content).toBe('  {{char}}\n---\n# x\r\n');
  const before = await readFile(join(directory, 'alpha.yaml'), 'utf8');
  await migrateJsonPresets(directory, repository);
  expect(await readFile(join(directory, 'alpha.yaml'), 'utf8')).toBe(before);
  expect(await repository.list()).toHaveLength(2);
});

it('only renames the JSON when a YAML with the same id already exists', async () => {
  const a = legacyPreset('Alpha');
  const repository = new PresetRepository(directory);
  await repository.save({ ...a, description: 'newer yaml' });
  await writeFile(join(directory, `${a.id}.json`), JSON.stringify(a));
  await migrateJsonPresets(directory, repository);
  expect(await names()).toEqual(['alpha.yaml', `${a.id}.json.migrated`].sort());
  expect((await repository.get(a.id))?.description).toBe('newer yaml');
});

it('leaves unreadable or invalid JSON untouched', async () => {
  await writeFile(join(directory, 'broken.json'), '{ nope');
  await writeFile(join(directory, 'invalid.json'), JSON.stringify({ id: randomUUID(), name: '' }));
  const repository = new PresetRepository(directory);
  await migrateJsonPresets(directory, repository);
  expect(await names()).toEqual(['broken.json', 'invalid.json']);
  expect(await readFile(join(directory, 'broken.json'), 'utf8')).toBe('{ nope');
});

it('keeps the JSON and removes its YAML when verification fails', async () => {
  const a = legacyPreset('Alpha');
  const json = JSON.stringify(a);
  await writeFile(join(directory, `${a.id}.json`), json);
  const repository = new PresetRepository(directory);
  const get = repository.get.bind(repository);
  vi.spyOn(repository, 'get').mockImplementation(async (id) => {
    const found = await get(id);
    return found && { ...found, name: 'Corrupted' };
  });
  await migrateJsonPresets(directory, repository);
  expect(await names()).toEqual([`${a.id}.json`]);
  expect(await readFile(join(directory, `${a.id}.json`), 'utf8')).toBe(json);
});
