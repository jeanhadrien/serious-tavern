import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apiContract } from '@st/shared';
import { tempApps, type App } from './test-support/story.js';

// What GET /api/sessions/:id/state says about the runs after the reply that a stored turn left behind.

const apps = tempApps('session-state-post');
afterEach(() => apps.cleanup());

const view = async (app: App, sessionId: string) => {
  const response = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
  expect(response.statusCode).toBe(200);
  return apiContract.getSessionState.response.parse(response.json());
};

const DATE = '2026-01-01T00:00:00.000Z';

/** Writes a session file by hand, as an older or edited installation would have it. */
async function stored(directory: string, extra: object) {
  const id = randomUUID();
  await mkdir(join(directory, 'sessions'), { recursive: true });
  await writeFile(
    join(directory, 'sessions', `${id}.json`),
    JSON.stringify({
      id,
      title: 'Old',
      workflowId: randomUUID(),
      messages: [],
      createdAt: DATE,
      updatedAt: DATE,
      ...extra,
    }),
  );
  return id;
}

describe('the runs after the reply of a stored turn', () => {
  const run = (status: unknown, extra: object = {}) => ({
    executionId: 'post-1',
    workflowId: 'w',
    part: 'post',
    status,
    ...extra,
  });
  const entry = (...runs: object[]) => ({
    executionId: 'x',
    at: DATE,
    completed: true,
    replies: 0,
    writes: [],
    runs,
  });

  it('reads as an error after a restart, without rewriting the file', async () => {
    const { app, directory } = await apps.open();
    try {
      const id = await stored(directory, { state: { turns: [entry(run('running'))] } });
      const path = join(directory, 'sessions', `${id}.json`);
      const before = await readFile(path);
      expect((await view(app, id)).turns[0]).toMatchObject({
        turnNumber: 1,
        postStatus: 'error',
        postExecutionId: 'post-1',
        postError: expect.stringContaining('interrupted by a server restart'),
        runs: [{ status: 'error', error: expect.stringContaining('interrupted by a server restart') }],
      });
      expect((await readFile(path)).equals(before)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['completed', [run('completed')], { postStatus: 'completed' }],
    ['an error with its message', [run('error', { error: 'boom' })], { postStatus: 'error', postError: 'boom' }],
    ['stopped', [run('stopped')], { postStatus: 'stopped' }],
    ['a run with a bad status, which is skipped', [run(7)], {}],
    ['an entry with no runs at all', [], {}],
  ])('reports %s as stored', async (_name, runs, expected) => {
    const { app, directory } = await apps.open();
    try {
      const id = await stored(directory, { state: { turns: [entry(...runs)] } });
      const turnView = (await view(app, id)).turns[0]!;
      expect(turnView).toMatchObject(expected);
      if (!('postStatus' in expected)) expect(turnView).not.toHaveProperty('postStatus');
    } finally {
      await app.close();
    }
  });

  it('does not read the stored post fields of an entry that was never released with them', async () => {
    const { app, directory } = await apps.open();
    try {
      const old = { ...entry(), postExecutionId: 'post-1', postStatus: 'completed' };
      const id = await stored(directory, { state: { turns: [old] } });
      expect((await view(app, id)).turns[0]).not.toHaveProperty('postStatus');
    } finally {
      await app.close();
    }
  });
});
