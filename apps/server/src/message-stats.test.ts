import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { apiContract } from '@st/shared';
import { makeSession, makeWorkflow, node, tempApps, type App } from './test-support/story.js';

const apps = tempApps('message-stats');
afterEach(() => apps.cleanup());

const NOT_FOUND = '00000000-0000-4000-8000-000000000000';
const message = (id: string, role: 'user' | 'assistant', content: string, extra: object = {}) => ({
  id,
  role,
  content,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

/** A chat whose stored messages are the given ones (written straight to the file, like a chat from an older version). */
async function chatWith(messages: object[]) {
  const { app, directory } = await apps.open();
  const workflow = await makeWorkflow(app, [node('in', 'chat-input')], []);
  const session = await makeSession(app, workflow.id);
  const path = join(directory, 'sessions', `${session.id}.json`);
  await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), messages }));
  return { app, session };
}

const getStats = async (app: App, id: string) => {
  const response = await app.inject({ method: 'GET', url: `/api/sessions/${id}/stats` });
  expect(response.statusCode, response.body).toBe(200);
  return apiContract.getSessionStats.response.parse(response.json());
};
const setting = (app: App, value: boolean) =>
  app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { showMessageStats: value } });

const REPEATED = 'The old door creaked open and the cold wind rushed in. She did not answer him.';

describe('GET /api/sessions/:id/stats', () => {
  it('is disabled by default and computes nothing', async () => {
    const { app, session } = await chatWith([message('a1', 'assistant', REPEATED)]);
    expect(await getStats(app, session.id)).toEqual({ enabled: false, messages: {} });
    await app.close();
  });

  it('gives stats to assistant replies, each against the replies before it', async () => {
    const { app, session } = await chatWith([
      message('u1', 'user', 'hello'),
      message('a1', 'assistant', REPEATED),
      message('u2', 'user', 'and then'),
      message('a2', 'assistant', REPEATED),
    ]);
    await setting(app, true);
    const { enabled, messages } = await getStats(app, session.id);
    expect(enabled).toBe(true);
    expect(Object.keys(messages)).toEqual(['a1', 'a2']);
    expect(messages.a1).toMatchObject({ words: 16, mtld: null, ngramOverlap: null, recycledSentences: 0 });
    expect(messages.a2).toMatchObject({ ngramOverlap: 1, recycledSentences: 2 });
    await app.close();
  });

  it('leaves out hidden alternatives and streaming rows, and keeps a stopped reply out of the windows', async () => {
    const { app, session } = await chatWith([
      message('u1', 'user', 'hello'),
      message('hidden', 'assistant', REPEATED, { inactive: true }),
      message('stopped', 'assistant', REPEATED, { status: 'partial' }),
      message('live', 'assistant', 'still typing', { status: 'streaming' }),
      message('a1', 'assistant', REPEATED),
    ]);
    await setting(app, true);
    const { messages } = await getStats(app, session.id);
    expect(Object.keys(messages)).toEqual(['stopped', 'a1']);
    expect(messages.stopped?.words).toBe(16);
    // The stopped reply is not in the window of the one after it.
    expect(messages.a1?.ngramOverlap).toBeNull();
    await app.close();
  });

  it('answers 404 for an unknown chat', async () => {
    const { app } = await apps.open();
    const response = await app.inject({ method: 'GET', url: `/api/sessions/${NOT_FOUND}/stats` });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
