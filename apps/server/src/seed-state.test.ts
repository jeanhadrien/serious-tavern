import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { apiContract, stateDefinitionSchema } from '@st/shared';
import { createApp } from './app.js';
import { SCENE_DEFINITION_ID, sceneDefinition, seedStateDefinitions } from './seed-state.js';
import { StateDefinitionRepository } from './storage/state-definition-repository.js';

let directory: string;
let warn: MockInstance<typeof console.warn>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'seed-state-test-'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  warn.mockRestore();
  await rm(directory, { recursive: true, force: true });
});

it('defines the scene example as the spec says, and it is a valid stored definition', () => {
  const scene = sceneDefinition();
  expect(stateDefinitionSchema.parse(scene)).toEqual(scene);
  expect(scene).toMatchObject({ id: SCENE_DEFINITION_ID, name: 'scene', description: expect.any(String) });
  expect(scene.keys).toEqual({
    tension: { type: 'number', default: 3, min: 0, max: 10 },
    mood: { type: 'enum', options: ['calm', 'uneasy', 'tense', 'release'], default: 'calm' },
    lastInjectionLevel: { type: 'number' },
    injected: { type: 'collection', cap: 30, fields: { level: 'number', entryId: 'text' } },
  });
});

it('seeds scene into an empty directory as a readable YAML file', async () => {
  const repository = new StateDefinitionRepository(directory);
  await seedStateDefinitions(repository);
  expect(await readdir(directory)).toEqual(['scene.yaml']);
  const text = await readFile(join(directory, 'scene.yaml'), 'utf8');
  expect(
    text.startsWith(
      'name: scene\ndescription: Pacing state for the creativity pipeline\nkeys:\n  tension:\n    type: number\n',
    ),
  ).toBe(true);
  expect((await repository.list()).map((definition) => definition.id)).toEqual([SCENE_DEFINITION_ID]);
});

it('is idempotent: a second call, and two at once, leave one file', async () => {
  const repository = new StateDefinitionRepository(directory);
  await seedStateDefinitions(repository);
  const text = await readFile(join(directory, 'scene.yaml'), 'utf8');
  await seedStateDefinitions(repository);
  expect(await readFile(join(directory, 'scene.yaml'), 'utf8')).toBe(text);

  const fresh = new StateDefinitionRepository(join(directory, 'fresh'));
  await Promise.all([seedStateDefinitions(fresh), seedStateDefinitions(fresh), seedStateDefinitions(fresh)]);
  expect(await readdir(join(directory, 'fresh'))).toEqual(['scene.yaml']);
});

it('never overwrites a scene the user changed', async () => {
  const repository = new StateDefinitionRepository(directory);
  await seedStateDefinitions(repository);
  await repository.update(SCENE_DEFINITION_ID, (current) => ({
    ...current,
    description: 'mine',
    keys: { tension: { type: 'number' } },
  }));
  const text = await readFile(join(directory, 'scene.yaml'), 'utf8');
  await seedStateDefinitions(repository);
  expect(await readFile(join(directory, 'scene.yaml'), 'utf8')).toBe(text);
  expect(await repository.get(SCENE_DEFINITION_ID)).toMatchObject({ description: 'mine' });
});

it('seeds nothing once the user has any definition, even under another name, or a file the server skipped', async () => {
  await writeFile(join(directory, 'mine.yaml'), 'name: mine\nkeys: {}\n');
  await seedStateDefinitions(new StateDefinitionRepository(directory));
  expect(await readdir(directory)).toEqual(['mine.yaml']);

  const broken = join(directory, 'broken');
  await new StateDefinitionRepository(broken).list();
  await writeFile(join(broken, 'x.yaml'), 'name: [unclosed\n');
  await seedStateDefinitions(new StateDefinitionRepository(broken));
  expect(await readdir(broken)).toEqual(['x.yaml']);
  expect(await readFile(join(broken, 'x.yaml'), 'utf8')).toBe('name: [unclosed\n');
});

it('is part of app start-up when seeding is on, and off for tests that ask for no seed', async () => {
  const seeded = await createApp(join(directory, 'seeded'));
  try {
    const list = apiContract.listStateDefinitions.response.parse(
      (await seeded.inject({ url: '/api/state-definitions' })).json(),
    );
    expect(list.map((definition) => definition.name)).toEqual(['scene']);
  } finally {
    await seeded.close();
  }
  const plain = await createApp(join(directory, 'plain'), { seed: false });
  try {
    expect((await plain.inject({ url: '/api/state-definitions' })).json()).toEqual([]);
  } finally {
    await plain.close();
  }
  // A restart changes nothing.
  const again = await createApp(join(directory, 'seeded'));
  try {
    expect((await again.inject({ url: '/api/state-definitions' })).json()).toHaveLength(1);
  } finally {
    await again.close();
  }
});
