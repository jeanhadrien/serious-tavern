import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import type { Preset, PresetSource } from '@st/shared';
import { createApp } from './app.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const source: PresetSource = {
  app: 'sillytavern',
  installPath: 'C:/SillyTavern',
  user: 'default-user',
  file: 'Imported.json',
  hash: 'a'.repeat(64),
  importedAt: '2026-01-01T00:00:00.000Z',
};

// Writes a preset straight into the repository directory, the way an import would.
async function setup(withSource: boolean) {
  const dataDir = await mkdtemp(join(tmpdir(), 'presets-test-'));
  directories.push(dataDir);
  const id = randomUUID();
  const preset: Preset = {
    id,
    name: withSource ? 'Imported' : 'Local',
    inputs: [],
    entries: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...(withSource ? { source } : {}),
  };
  await mkdir(join(dataDir, 'presets'), { recursive: true });
  await writeFile(join(dataDir, 'presets', `${id}.json`), JSON.stringify(preset, null, 2));
  const app = await createApp(dataDir, { seed: false });
  return { app, dataDir, id };
}

it('refuses updates to imported presets with PRESET_READ_ONLY and leaves the record unchanged', async () => {
  const { app, dataDir, id } = await setup(true);
  const before = await readFile(join(dataDir, 'presets', `${id}.json`), 'utf8');
  const response = await app.inject({
    method: 'PUT',
    url: `/api/presets/${id}`,
    payload: { name: 'Edited', inputs: [], entries: [] },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().error.code).toBe('PRESET_READ_ONLY');
  expect(await readFile(join(dataDir, 'presets', `${id}.json`), 'utf8')).toBe(before);
});

it('still allows deleting imported presets', async () => {
  const { app, id } = await setup(true);
  const response = await app.inject({ method: 'DELETE', url: `/api/presets/${id}` });
  expect(response.statusCode).toBe(204);
});

it('strips a client-supplied source on create so duplicates are editable', async () => {
  const { app } = await setup(false);
  const response = await app.inject({
    method: 'POST',
    url: '/api/presets',
    payload: { name: 'Copy', inputs: [], entries: [], source },
  });
  expect(response.statusCode).toBe(201);
  expect(response.json()).not.toHaveProperty('source');
});

it('never lets a client set or change source through an update of a normal preset', async () => {
  const { app, id } = await setup(false);
  const response = await app.inject({
    method: 'PUT',
    url: `/api/presets/${id}`,
    payload: { name: 'Local', inputs: [], entries: [], source },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).not.toHaveProperty('source');
  const stored = await app.inject({ method: 'GET', url: `/api/presets/${id}` });
  expect(stored.json()).not.toHaveProperty('source');
});
