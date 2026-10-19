import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { renderPreset, type ChatRequest } from '@st/engine';
import { apiContract, type SessionStateView } from '@st/shared';
import { createApp } from './app.js';
import { STORY_DIRECTOR_WORKFLOW_ID, storyDirector } from './examples/story-director.js';
import { beatsCollection } from './examples/story-beats.js';
import { restoreAdapter, useAdapter } from './test-support/adapter.js';
import { deleteMessage, entriesOf, makeSession, readSession, turn, type App } from './test-support/story.js';

let directory: string;
let app: App | undefined;
let quiet: MockInstance<typeof console.log> | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'story-director-'));
  quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  restoreAdapter();
  quiet?.mockRestore();
  await app?.close();
  app = undefined;
  await rm(directory, { recursive: true, force: true });
});

const isRating = (request: ChatRequest) => request.messages.some((m) => m.content.includes('Rate how intense'));
const PHASES = ['Build', 'Peak', 'Fade', 'Relax'] as const;
// The phase a narrator request was told, from the pacing directive in its prompt.
const phaseOf = (request: ChatRequest) =>
  PHASES.find((phase) => request.messages.some((m) => m.content.startsWith(`Story pacing: ${phase}:`)));
const stateOf = async (id: string) =>
  apiContract.getSessionState.response.parse(
    (await app!.inject({ method: 'GET', url: `/api/sessions/${id}/state` })).json(),
  );
const memoryCount = (view: SessionStateView) => view.nodes.find((node) => node.nodeId === 'pacing')?.meta.beats?.count;
const tension = (view: SessionStateView) =>
  view.definitions.find((definition) => definition.name === 'director')?.values.tension;

/** Waits for the after-reply run of the newest turn: its rating is written once it is done. */
const postSettled = (id: string, turns: number) =>
  vi.waitFor(async () => {
    const entries = entriesOf(await readSession(app!, id));
    expect(entries).toHaveLength(turns);
    expect(entries.at(-1)?.postStatus).toBe('completed');
  });

async function start(ratings: string[]) {
  const narrator: ChatRequest[] = [];
  const rated: ChatRequest[] = [];
  useAdapter({
    chat: async (request) => {
      if (isRating(request)) {
        rated.push(request);
        return { text: ratings[rated.length - 1] ?? '0', raw: {} };
      }
      narrator.push(request);
      return { text: `reply ${narrator.length}`, raw: {} };
    },
  });
  app = await createApp(directory, { seed: true, examples: true });
  await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
  return { narrator, rated, session: await makeSession(app, STORY_DIRECTOR_WORKFLOW_ID) };
}

it('paces the story from the rated tension, tells the model the phase and rolls back with a deleted reply', async () => {
  // Each rating is written after its reply and read by the next turn: the first turn has none (default 0).
  const { narrator, rated, session } = await start(['0.2', '0.3', '0.9', '0.9', '0.9', '0', '0', '0', '0.5']);
  for (let n = 1; n <= 9; n++) expect(await turn(app!, session.id, `message ${n}`)).toEqual([`reply ${n}`]);
  await postSettled(session.id, 9);
  expect(rated).toHaveLength(9);
  expect(narrator.map(phaseOf)).toEqual(['Build', 'Build', 'Build', 'Peak', 'Peak', 'Fade', 'Fade', 'Fade', 'Relax']);

  // The rating call sees the exchange; its answer is the story's tension, and the director's memory is on the chat.
  expect(rated[0]!.messages.map((m) => m.content).join('\n')).toContain('User: message 1\nReply: reply 1');
  const view = await stateOf(session.id);
  expect(tension(view)).toBe(0.5);
  expect(memoryCount(view)).toBe(9);

  // Delete the newest reply: its rating and its beat go with it, so the next turn is the same turn again.
  const stored = await readSession(app!, session.id);
  const last = stored.messages.filter((message) => message.role === 'assistant').at(-1)!;
  expect((await deleteMessage(app!, session.id, last.id)).statusCode).toBe(204);
  expect(tension(await stateOf(session.id))).toBe(0);
  expect(memoryCount(await stateOf(session.id))).toBe(8);
  expect(await turn(app!, session.id, 'message 9 again')).toEqual(['reply 10']);
  expect(phaseOf(narrator[9]!)).toBe('Relax');
});

it('answers every turn without a rating too: the beat clock and a failing rating call do not stop the story', async () => {
  const { narrator, session } = await start(['not a number']);
  for (let n = 1; n <= 3; n++) expect(await turn(app!, session.id)).toEqual([`reply ${n}`]);
  // The rating was not a number, so nothing was written: tension stays at its default and the story builds.
  expect(narrator.map(phaseOf)).toEqual(['Build', 'Build', 'Build']);
  expect(tension(await stateOf(session.id))).toBe(0);
});

it('offers the detail only when the Trigger fired, and words the directive and the offer as entries that can be empty', () => {
  const preset = storyDirector.presets()[0]!;
  const render = (inputs: Record<string, unknown>) =>
    renderPreset(preset, {
      inputs: { history: [], message: 'hello', ...inputs },
      templateContext: { trigger: { message: 'hello', sessionId: 's' }, history: [] },
    }).map((message) => message.content);
  expect(render({}).some((content) => content.includes('Story pacing') || content.includes('weave in'))).toBe(false);
  expect(render({ guidance: 'Relax: breathe.', seed: 'A bell rings.' })).toEqual(
    expect.arrayContaining(['Story pacing: Relax: breathe.', 'If it fits, weave in: A bell rings.']),
  );
});

it('has a deck that reaches every level the director allows', () => {
  const levels = new Set(beatsCollection().entries.map((entry) => entry.level));
  expect([...levels].sort()).toEqual([1, 2, 3, 4, 5]);
});
