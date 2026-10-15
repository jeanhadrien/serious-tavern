import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { apiContract, errorEnvelopeSchema, turnFailureDetailsSchema, type Session } from '@st/shared';
import { createApp } from './app.js';
import { restoreAdapter, useAdapter } from './test-support/adapter.js';

// Chat settings belong to the user: nothing that rewinds or ends a turn may change them.

type App = Awaited<ReturnType<typeof createApp>>;
const directories: string[] = [];
const apps: App[] = [];
afterEach(async () => {
  restoreAdapter();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({
  id: `${source}-${target}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const declarations = [
  { key: 'volatility', type: 'number', default: 0.3, min: 0, max: 1 },
  { key: 'mood', type: 'enum', options: ['calm', 'tense'] },
];

async function setup(graph: { nodes: unknown[]; edges: unknown[] }, settings: unknown[] = declarations) {
  const directory = join(process.cwd(), '.test-data', `chat-settings-history-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  apps.push(app);
  await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
  const created = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'W' } })).json();
  const saved = await app.inject({
    method: 'PUT',
    url: `/api/workflows/${created.id}`,
    payload: { name: 'W', ...graph, settings },
  });
  expect(saved.statusCode).toBe(200);
  const session = (
    await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: created.id } })
  ).json() as Session;
  const stored = { volatility: 0.8, mood: 'tense' };
  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/sessions/${session.id}`,
    payload: { settings: stored },
  });
  expect(patched.statusCode).toBe(200);
  return { app, session, stored, workflowId: created.id as string };
}
const read = async (app: App, id: string): Promise<Session> =>
  apiContract.getSession.response.parse((await app.inject({ method: 'GET', url: `/api/sessions/${id}` })).json());

it('keeps settings through message edits, deletes and a stopped turn', async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  useAdapter({
    chat: async () => {
      throw new Error('These tests stream');
    },
    stream: async (_request, { signal }) => {
      entered();
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
    },
  });
  const echo = { nodes: [node('input', 'chat-input'), node('output', 'chat-output')], edges: [] as unknown[] };
  echo.edges.push(edge('input', 'message', 'output', 'value'));
  const { app, session, stored, workflowId } = await setup(echo);
  const sent = await app.inject({
    method: 'POST',
    url: `/api/sessions/${session.id}/messages`,
    payload: { content: 'hello' },
  });
  expect(sent.statusCode).toBe(200);
  const [user, reply] = (await read(app, session.id)).messages;
  const edited = await app.inject({
    method: 'PATCH',
    url: `/api/sessions/${session.id}/messages/${user!.id}`,
    payload: { content: 'edited' },
  });
  expect(edited.statusCode).toBe(200);
  expect((await read(app, session.id)).settings).toEqual(stored);
  const deleted = await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}/messages/${reply!.id}` });
  expect(deleted.statusCode).toBe(204);
  expect((await read(app, session.id)).settings).toEqual(stored);

  // Switch the chat to a streaming LLM workflow and stop its turn halfway.
  const preset = (
    await app.inject({ method: 'POST', url: '/api/presets', payload: { name: 'P', inputs: [], entries: [] } })
  ).json();
  await app.inject({
    method: 'PUT',
    url: `/api/workflows/${workflowId}`,
    payload: {
      name: 'W',
      nodes: [
        node('input', 'chat-input'),
        node('llm', 'llm', { presetId: preset.id, provider: 'openrouter', model: 'm' }),
        node('output', 'chat-output'),
      ],
      edges: [edge('llm', 'text', 'output', 'value')],
    },
  });
  const turn = app.inject({
    method: 'POST',
    url: `/api/sessions/${session.id}/messages/stream`,
    payload: { content: 'again' },
  });
  await started;
  expect((await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` })).statusCode).toBe(204);
  expect((await turn).body).toContain('TURN_STOPPED');
  expect((await read(app, session.id)).settings).toEqual(stored);
});

it('reports a stored value the workflow no longer accepts on a failed turn too, and keeps it', async () => {
  const graph = {
    nodes: [node('input', 'chat-input'), node('parse', 'parse-json'), node('output', 'chat-output')],
    edges: [edge('input', 'message', 'parse', 'text'), edge('parse', 'value', 'output', 'value')],
  };
  const { app, session, stored, workflowId } = await setup(graph);
  const narrowed = declarations.map((item) => (item.key === 'volatility' ? { ...item, max: 0.5 } : item));
  await app.inject({
    method: 'PUT',
    url: `/api/workflows/${workflowId}`,
    payload: { name: 'W', ...graph, settings: narrowed },
  });
  const response = await app.inject({
    method: 'POST',
    url: `/api/sessions/${session.id}/messages`,
    payload: { content: 'not json' },
  });
  expect(response.statusCode).toBeGreaterThanOrEqual(400);
  const { error } = errorEnvelopeSchema.parse(response.json());
  const details = turnFailureDetailsSchema.parse(error.details);
  expect(details.execution?.warnings).toContain(
    'Chat setting "volatility": Stored value 0.8 is above max 0.5; using default 0.3.',
  );
  expect((await read(app, session.id)).settings).toEqual(stored);
});
