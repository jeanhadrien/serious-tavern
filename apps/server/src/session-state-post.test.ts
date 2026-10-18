import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apiContract } from '@st/shared';
import { tempApps, type App } from './test-support/story.js';

// What GET /api/sessions/:id/state says about the after-reply run a stored turn left behind.

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

describe('the post-turn run of a stored turn', () => {
  const entry = (extra: object) => ({
    executionId: 'x',
    at: DATE,
    completed: true,
    replies: 0,
    writes: [],
    postExecutionId: 'post-1',
    ...extra,
  });

  it('reads as an error after a restart, without rewriting the file', async () => {
    const { app, directory } = await apps.open();
    try {
      const id = await stored(directory, { state: { turns: [entry({ postStatus: 'running' })] } });
      const path = join(directory, 'sessions', `${id}.json`);
      const before = await readFile(path);
      expect((await view(app, id)).turns[0]).toMatchObject({
        turnNumber: 1,
        postStatus: 'error',
        postExecutionId: 'post-1',
        postError: expect.stringContaining('interrupted by a server restart'),
      });
      expect((await readFile(path)).equals(before)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['completed', { postStatus: 'completed' }, { postStatus: 'completed' }],
    [
      'an error with its message',
      { postStatus: 'error', postError: 'boom' },
      { postStatus: 'error', postError: 'boom' },
    ],
    ['stopped', { postStatus: 'stopped' }, { postStatus: 'stopped' }],
    ['a bad status', { postStatus: 7 }, {}],
  ])('reports %s as stored', async (_name, stored_, expected) => {
    const { app, directory } = await apps.open();
    try {
      const id = await stored(directory, { state: { turns: [entry(stored_)] } });
      const turnView = (await view(app, id)).turns[0]!;
      expect(turnView).toMatchObject(expected);
      if (!('postStatus' in expected)) expect(turnView).not.toHaveProperty('postStatus');
    } finally {
      await app.close();
    }
  });
});
