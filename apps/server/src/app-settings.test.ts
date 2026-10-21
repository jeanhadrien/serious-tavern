import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiContract } from '@st/shared';
import { tempApps } from './test-support/story.js';

const apps = tempApps('app-settings');
afterEach(async () => {
  vi.restoreAllMocks();
  await apps.cleanup();
});

const get = (app: Awaited<ReturnType<typeof apps.open>>['app']) =>
  app.inject({ method: 'GET', url: '/api/app-settings' });
const patch = (app: Awaited<ReturnType<typeof apps.open>>['app'], payload: unknown) =>
  app.inject({ method: 'PATCH', url: '/api/app-settings', payload: payload as object });

describe('app settings', () => {
  it('answers the defaults with no file, and writes nothing until the first update', async () => {
    const { app, directory } = await apps.open();
    const response = await get(app);
    expect(response.statusCode).toBe(200);
    expect(apiContract.getAppSettings.response.parse(response.json())).toEqual({
      forkKeepsAlternatives: true,
      showMessageStats: false,
    });
    await expect(readFile(join(directory, 'app-settings.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await app.close();
  });

  it('merges a patch into the file and keeps the keys it does not know', async () => {
    const { app, directory } = await apps.open();
    const path = join(directory, 'app-settings.json');
    await mkdir(directory, { recursive: true });
    await writeFile(path, JSON.stringify({ futureThing: { a: 1 }, forkKeepsAlternatives: 'oops' }));
    // A value of the wrong type reads as the default.
    expect((await get(app)).json()).toMatchObject({ forkKeepsAlternatives: true, futureThing: { a: 1 } });
    const updated = await patch(app, { forkKeepsAlternatives: false });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(apiContract.updateAppSettings.response.parse(updated.json())).toEqual({
      forkKeepsAlternatives: false,
      showMessageStats: false,
      futureThing: { a: 1 },
    });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ forkKeepsAlternatives: false, futureThing: { a: 1 } });
    expect((await get(app)).json().forkKeepsAlternatives).toBe(false);
    // An empty patch changes nothing; a bad one is refused.
    expect((await patch(app, {})).json().forkKeepsAlternatives).toBe(false);
    expect((await patch(app, { forkKeepsAlternatives: 'yes' })).statusCode).toBe(400);
    await app.close();
  });

  it('keeps concurrent updates from losing each other', async () => {
    const { app, directory } = await apps.open();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'app-settings.json'), JSON.stringify({ other: 1 }));
    await Promise.all([patch(app, { forkKeepsAlternatives: false }), patch(app, {}), patch(app, {})]);
    expect(JSON.parse(await readFile(join(directory, 'app-settings.json'), 'utf8'))).toEqual({
      other: 1,
      forkKeepsAlternatives: false,
    });
    await app.close();
  });

  it.each(['{ not json', '[1, 2]', '"text"'])('never overwrites an unreadable file (%s)', async (content) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { app, directory } = await apps.open();
    const path = join(directory, 'app-settings.json');
    await mkdir(directory, { recursive: true });
    await writeFile(path, content);
    const response = await get(app);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ forkKeepsAlternatives: true, showMessageStats: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(path));
    const refused = await patch(app, { forkKeepsAlternatives: false });
    expect(refused.statusCode).toBe(500);
    expect(refused.json().error).toMatchObject({ code: 'APP_SETTINGS_UNREADABLE' });
    expect(refused.json().error.message).toContain(path);
    expect(await readFile(path, 'utf8')).toBe(content);
    await app.close();
    await rm(path);
  });
});
