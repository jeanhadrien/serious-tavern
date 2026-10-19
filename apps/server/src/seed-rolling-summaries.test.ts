import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import type { ChatRequest } from '@st/engine';
import { apiContract, type SessionStateView } from '@st/shared';
import { createApp } from './app.js';
import { ROLLING_SUMMARIES_WORKFLOW_ID } from './examples/rolling-summaries.js';
import { restoreAdapter, useAdapter } from './test-support/adapter.js';
import { makeSession, readSession, turn, type App } from './test-support/story.js';

let directory: string;
let app: App | undefined;
let quiet: MockInstance<typeof console.log> | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rolling-summaries-'));
  quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  restoreAdapter();
  quiet?.mockRestore();
  await app?.close();
  app = undefined;
  await rm(directory, { recursive: true, force: true });
});

const isSummarizer = (request: ChatRequest) => request.messages.some((m) => m.content.includes('Condense the chat'));
const SUMMARY_HEADER = 'Summary of the earlier chat:';
const stateOf = async (id: string) =>
  apiContract.getSessionState.response.parse(
    (await app!.inject({ method: 'GET', url: `/api/sessions/${id}/state` })).json(),
  );
const summaries = (view: SessionStateView) =>
  (view.definitions.find((definition) => definition.name === 'memory')?.values.summaries ?? []) as {
    text: string;
    link?: { status: string; count: number; firstIndex?: number; lastIndex?: number };
  }[];

it('summarizes the oldest chunk after the reply, uses the summary instead of those messages and redoes it after an edit', async () => {
  const narrator: ChatRequest[] = [];
  const summarizer: ChatRequest[] = [];
  useAdapter({
    chat: async (request) => {
      if (isSummarizer(request)) {
        summarizer.push(request);
        return { text: `SUMMARY ${summarizer.length}`, raw: {} };
      }
      narrator.push(request);
      return { text: `reply ${narrator.length}`, raw: {} };
    },
  });
  app = await createApp(directory, { seed: true, examples: true });
  await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
  const session = await makeSession(app, ROLLING_SUMMARIES_WORKFLOW_ID);

  // 21 turns. A post run sees the history before its own turn, so the 19th turn's run is the first to see 36 messages,
  // 20 of them older than the newest 16.
  for (let n = 1; n <= 21; n++) expect(await turn(app, session.id, `message ${n}`)).toEqual([`reply ${n}`]);
  expect(summarizer).toHaveLength(1);
  const excerpt = summarizer[0]!.messages.map((m) => m.content).join('\n');
  expect(excerpt).toContain('user: message 1\nassistant: reply 1\n');
  expect(excerpt).toContain('assistant: reply 10');
  expect(excerpt).not.toContain('message 11');

  const view = await stateOf(session.id);
  expect(summaries(view)).toMatchObject([
    { text: 'SUMMARY 1', link: { status: 'intact', count: 20, firstIndex: 1, lastIndex: 20 } },
  ]);

  // The turn after the summary carries it, and only the messages it does not stand for.
  const system = (request: ChatRequest) => request.messages.filter((m) => m.role === 'system').map((m) => m.content);
  const raw = (request: ChatRequest) => request.messages.filter((m) => m.role !== 'system').map((m) => m.content);
  expect(narrator[17]!.messages.some((m) => m.content.includes(SUMMARY_HEADER))).toBe(false);
  expect(system(narrator[20]!).filter((content) => content.includes('SUMMARY'))).toEqual([
    `${SUMMARY_HEADER}\nSUMMARY 1`,
  ]);
  expect(raw(narrator[20]!)).not.toContain('message 1');
  expect(raw(narrator[20]!)).not.toContain('reply 10');
  expect(raw(narrator[20]!)).toContain('message 11');
  expect(raw(narrator[20]!)).toContain('message 21');

  // Editing a summarized message breaks the link: the summary is not used and the messages come back raw.
  const stored = await readSession(app, session.id);
  const edited = stored.messages.find((m) => m.content === 'message 5')!;
  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/sessions/${session.id}/messages/${edited.id}`,
    payload: { content: 'message five' },
  });
  expect(patched.statusCode).toBe(200);
  expect(await turn(app, session.id, 'message 22')).toEqual(['reply 22']);
  const after = narrator[21]!;
  expect(after.messages.some((m) => m.content.includes('SUMMARY 1'))).toBe(false);
  expect(raw(after)).toContain('message five');
  // The next post run redid the chunk; one more turn waits for it, so the new summary is in place by then.
  expect(await turn(app, session.id, 'message 23')).toEqual(['reply 23']);
  expect(summarizer).toHaveLength(2);
  expect(system(narrator[22]!).some((content) => content.includes('SUMMARY 2'))).toBe(true);
  expect(raw(narrator[22]!)).not.toContain('message five');
});
