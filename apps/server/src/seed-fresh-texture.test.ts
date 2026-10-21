import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { renderPreset } from '@st/engine';
import { apiContract, type SessionStateView } from '@st/shared';
import type { ChatRequest } from '@st/engine';
import { createApp } from './app.js';
import { FRESH_TEXTURE_WORKFLOW_ID, freshTexture } from './examples/fresh-texture.js';
import { chatResponse, restoreAdapter, useAdapter } from './test-support/adapter.js';
import { entriesOf, makeSession, readSession, turn, type App } from './test-support/story.js';

let directory: string;
let app: App | undefined;
let quiet: MockInstance<typeof console.log> | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fresh-texture-'));
  quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  restoreAdapter();
  quiet?.mockRestore();
  await app?.close();
  app = undefined;
  await rm(directory, { recursive: true, force: true });
});

const MARKERS = ['Optional color, only if it fits the moment:', 'If the story has room,', 'If it serves the story,'];
const wording = (request: ChatRequest) =>
  request.messages
    .map((message) => message.content)
    .filter((content) => MARKERS.some((marker) => content.includes(marker)));

const stateOf = async (id: string) =>
  apiContract.getSessionState.response.parse(
    (await app!.inject({ method: 'GET', url: `/api/sessions/${id}/state` })).json(),
  );
const injected = (view: SessionStateView) =>
  (view.definitions.find((definition) => definition.name === 'scene')?.values.injected ?? []) as {
    level: number;
    entryId?: string;
  }[];
const fires = (view: SessionStateView) => view.nodes.find((node) => node.nodeId === 'trigger')?.meta.fires?.count ?? 0;

it('answers every turn, injects a leveled detail now and then, and takes it back with the reply', async () => {
  const requests: ChatRequest[] = [];
  useAdapter({
    chat: async (request) => {
      requests.push(request);
      return chatResponse(`reply ${requests.length}`);
    },
  });
  app = await createApp(directory, { seed: true, examples: true });
  await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
  const session = await makeSession(app, FRESH_TEXTURE_WORKFLOW_ID);
  // The chat settings are the example's two knobs; restless makes it fire sooner.
  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/sessions/${session.id}`,
    payload: { settings: { volatility: 1, maxLevel: 3 } },
  });
  expect(patched.statusCode).toBe(200);

  for (let n = 1; n <= 30; n++) expect(await turn(app, session.id)).toEqual([`reply ${n}`]);
  expect(requests).toHaveLength(30);

  const stored = entriesOf(await readSession(app, session.id));
  const fired = stored.map((entry) =>
    entry.writes.some((write) => write.target.kind === 'node' && write.target.key === 'fires'),
  );
  expect(fired.filter(Boolean).length).toBeGreaterThan(0);
  // The detail is in the prompt exactly on the turns the Trigger fired, worded as an offer, once.
  for (const [index, request] of requests.entries()) expect(wording(request).length).toBe(fired[index] ? 1 : 0);
  const collection = freshTexture.collections()[0]!;
  for (const [index, request] of requests.entries())
    if (fired[index]) expect(collection.entries.some((entry) => wording(request)[0]!.includes(entry.text))).toBe(true);

  // The scene remembers what was injected and how strongly; the Trigger and Draw keep their own memory.
  const view = await stateOf(session.id);
  const count = fired.filter(Boolean).length;
  expect(injected(view)).toHaveLength(count);
  expect(fires(view)).toBe(count);
  // Each item keeps what the key declares (text, level, entryId) and nothing is logged as left out.
  expect(injected(view)[0]!.entryId).toMatch(/^entry-\d+$/);
  const firingTurn = stored[fired.lastIndexOf(true)]!;
  const log = (await app.inject({ method: 'GET', url: `/api/executions/${firingTurn.executionId}` })).json();
  expect(log.nodes.remember.status).toBe('completed');
  expect(log.nodes.remember.logs.join('\n')).not.toContain('Left out');
  const lastLevel = view.definitions.find((definition) => definition.name === 'scene')!.values.lastInjectionLevel;
  expect(lastLevel).toBe(injected(view)[0]!.level);

  // Delete the reply of the newest firing: its injection, firing and level are undone.
  const reloaded = await readSession(app, session.id);
  const lastFiring = fired.lastIndexOf(true);
  const reply = reloaded.messages.filter((message) => message.role === 'assistant')[lastFiring]!;
  expect(
    (await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}/messages/${reply.id}` })).statusCode,
  ).toBe(204);
  const rewound = await stateOf(session.id);
  expect(injected(rewound)).toHaveLength(count - 1);
  expect(fires(rewound)).toBe(count - 1);
});

it('words the detail by its level and leaves the entry out without one', async () => {
  const preset = freshTexture.presets()[0]!;
  const render = (inputs: Record<string, unknown>) =>
    renderPreset(preset, {
      inputs: { history: [], message: 'hello', ...inputs },
      templateContext: { trigger: { message: 'hello', sessionId: 's' }, history: [] },
    }).map((message) => message.content);
  expect(render({}).join('\n')).not.toContain('detail');
  expect(render({}).some((content) => MARKERS.some((marker) => content.includes(marker)))).toBe(false);
  expect(render({ seed: 'A bell rings.', level: '1' })).toContain(
    'Optional color, only if it fits the moment: A bell rings.',
  );
  expect(render({ seed: 'A bell rings.', level: '2' })).toContain(
    'If the story has room, let this touch the scene in a sentence or two: A bell rings.',
  );
  for (const level of ['3', '4', '5'])
    expect(render({ seed: 'A bell rings.', level })).toContain(
      'If it serves the story, you may bring this in as something the characters notice and react to: A bell rings.',
    );
  // The entry sits two messages from the end of the history.
  const withHistory = renderPreset(preset, {
    inputs: {
      history: ['a', 'b', 'c'].map((content, index) => ({ id: String(index), role: 'user', content, createdAt: '' })),
      message: 'hello',
      seed: 'S',
      level: '1',
    },
    templateContext: { trigger: { message: 'hello', sessionId: 's' }, history: [] },
  }).map((message) => message.content);
  expect(withHistory.findIndex((content) => content.includes('Optional color'))).toBeLessThan(withHistory.length - 1);
});
