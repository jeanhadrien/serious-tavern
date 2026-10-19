import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatRequest } from '@st/engine';
import { apiContract, errorEnvelopeSchema, turnEventSchema, type Session } from '@st/shared';
import { createApp } from './app.js';
import { mergeSettings } from './services/sessions.js';
import { restoreAdapter, useAdapter } from './test-support/adapter.js';
import { parseEventStream } from './test-support/event-stream.js';

type App = Awaited<ReturnType<typeof createApp>>;

const directories: string[] = [];
const apps: App[] = [];
afterEach(async () => {
  restoreAdapter();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const declarations = [
  { key: 'volatility', label: 'Volatility', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05 },
  { key: 'flag', type: 'boolean' },
  { key: 'mood', type: 'enum', options: ['calm', 'tense'], default: 'calm' },
  { key: 'note', type: 'text', multiline: true },
];
const echoGraph = (template: string) => ({
  nodes: [
    { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
    { id: 'output', type: 'chat-output', config: { template }, position: { x: 100, y: 0 } },
  ],
  edges: [{ id: 'reply', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'value' }],
});
const template = 'v={{settings.volatility}} f={{settings.flag}} m={{settings.mood}} n={{settings.note}}';

type Graph = { nodes: unknown[]; edges: unknown[] };
async function createWorkflow(
  app: App,
  name: string,
  settings: unknown[] | undefined,
  graph: Graph = echoGraph(template),
) {
  const created = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name } })).json();
  const response = await app.inject({
    method: 'PUT',
    url: `/api/workflows/${created.id}`,
    payload: { name, ...graph, ...(settings ? { settings } : {}) },
  });
  expect(response.statusCode).toBe(200);
  return apiContract.updateWorkflow.response.parse(response.json());
}

async function setup() {
  const directory = join(process.cwd(), '.test-data', `chat-settings-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  apps.push(app);
  const workflow = await createWorkflow(app, 'Dials', declarations);
  const session = apiContract.createSession.response.parse(
    (await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })).json(),
  );
  return { app, workflow, session };
}

const patch = (app: App, id: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: `/api/sessions/${id}`, payload });
const read = async (app: App, id: string): Promise<Session> =>
  apiContract.getSession.response.parse((await app.inject({ method: 'GET', url: `/api/sessions/${id}` })).json());
async function send(app: App, id: string) {
  const response = await app.inject({ method: 'POST', url: `/api/sessions/${id}/messages`, payload: { content: 'x' } });
  expect(response.statusCode).toBe(200);
  return apiContract.sendMessage.response.parse(response.json());
}

describe('chat settings on sessions', () => {
  it('starts empty and runs turns on the declared defaults', async () => {
    const { app, workflow, session } = await setup();
    expect(session.settings).toEqual({});
    expect((await read(app, session.id)).settings).toEqual({});
    expect(workflow.settings?.[1]).toEqual({ key: 'flag', type: 'boolean', default: false });
    const result = await send(app, session.id);
    expect(result.assistantMessages[0]?.content).toBe('v=0.3 f=false m=calm n=');
    expect(result.execution.settings).toEqual({ volatility: 0.3, flag: false, mood: 'calm', note: '' });
    expect(result.execution.warnings).not.toContainEqual(expect.stringContaining('Chat setting'));
  });

  it('merges patches, resets keys with null and never advances updatedAt', async () => {
    const { app, session } = await setup();
    await send(app, session.id);
    const before = (await read(app, session.id)).updatedAt;
    const first = await patch(app, session.id, { settings: { volatility: 0.8, mood: 'tense' } });
    expect(first.statusCode).toBe(200);
    expect(apiContract.updateSession.response.parse(first.json()).settings).toEqual({ volatility: 0.8, mood: 'tense' });
    expect((await patch(app, session.id, { settings: { flag: true, note: 'Rain.\nWind.' } })).statusCode).toBe(200);
    expect((await read(app, session.id)).updatedAt).toBe(before);
    expect((await send(app, session.id)).assistantMessages[0]?.content).toBe('v=0.8 f=true m=tense n=Rain.\nWind.');
    const reset = await patch(app, session.id, { settings: { volatility: null, ghost: null } });
    expect(reset.json().settings).toEqual({ mood: 'tense', flag: true, note: 'Rain.\nWind.' });
    expect((await send(app, session.id)).assistantMessages[0]?.content).toMatch(/^v=0\.3 /);
  });

  it.each([
    [{ volatility: 2 }, 'Chat setting "volatility": 2 is above max 1.'],
    [{ volatility: 'high' }, 'Chat setting "volatility": "high" is not a number.'],
    [{ mood: 'angry' }, 'Chat setting "mood": "angry" is not one of: calm, tense.'],
    [{ flag: 'yes' }, 'Chat setting "flag": "yes" is not true or false.'],
    [{ note: 5 }, 'Chat setting "note": 5 is not text.'],
    [{ volatilty: 0.5 }, 'Workflow "Dials" has no chat setting "volatilty".'],
    [{ volatility: 0.5, mood: 'angry' }, 'Chat setting "mood": "angry" is not one of: calm, tense.'],
  ])('rejects %j and writes nothing', async (settings, message) => {
    const { app, session } = await setup();
    await patch(app, session.id, { settings: { flag: true } });
    const response = await patch(app, session.id, { settings, title: 'Renamed' });
    expect(response.statusCode).toBe(400);
    const { error } = errorEnvelopeSchema.parse(response.json());
    expect(error).toMatchObject({ code: 'CHAT_SETTING_INVALID', message });
    const stored = await read(app, session.id);
    expect(stored.settings).toEqual({ flag: true });
    expect(stored.title).toBe('New chat');
  });

  it('keeps undeclared values across workflow switches and validates against the new workflow', async () => {
    const { app, workflow, session } = await setup();
    const other = await createWorkflow(app, 'Other', [{ key: 'level', type: 'number', min: 1, max: 5, default: 1 }], {
      ...echoGraph('l={{settings.level}} v={{settings.volatility}}'),
    });
    await patch(app, session.id, { settings: { volatility: 0.9 } });
    const rejected = await patch(app, session.id, { workflowId: other.id, settings: { mood: 'tense' } });
    expect(rejected.statusCode).toBe(400);
    expect((await read(app, session.id)).workflowId).toBe(workflow.id);
    const switched = await patch(app, session.id, { workflowId: other.id, settings: { level: 4 } });
    expect(switched.json()).toMatchObject({ workflowId: other.id, settings: { volatility: 0.9, level: 4 } });
    const onOther = await send(app, session.id);
    expect(onOther.assistantMessages[0]?.content).toBe('l=4 v=');
    expect(onOther.execution.settings).toEqual({ level: 4 });
    await patch(app, session.id, { workflowId: workflow.id });
    expect((await send(app, session.id)).assistantMessages[0]?.content).toMatch(/^v=0\.9 /);
  });

  it('ignores a stored value the workflow no longer accepts, with a warning, and keeps it stored', async () => {
    const { app, workflow, session } = await setup();
    await patch(app, session.id, { settings: { volatility: 0.8 } });
    const narrowed = declarations.map((item) => (item.key === 'volatility' ? { ...item, max: 0.5 } : item));
    await createWorkflowUpdate(app, workflow.id, narrowed);
    const result = await send(app, session.id);
    expect(result.assistantMessages[0]?.content).toMatch(/^v=0\.3 /);
    expect(result.execution.warnings).toContain(
      'Chat setting "volatility": Stored value 0.8 is above max 0.5; using default 0.3.',
    );
    expect((await read(app, session.id)).settings).toEqual({ volatility: 0.8 });
  });

  it('keeps declarations on a workflow PUT without settings and copies them on create', async () => {
    const { app, workflow } = await setup();
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: { name: 'Renamed', ...echoGraph(template) },
    });
    expect(updated.json().settings).toEqual(workflow.settings);
    const copy = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      payload: { name: 'Copy', ...echoGraph(template), settings: workflow.settings },
    });
    expect(copy.statusCode).toBe(201);
    expect(copy.json().settings).toEqual(workflow.settings);
    const plain = await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Plain' } });
    expect(plain.json()).not.toHaveProperty('settings');
  });

  it('rejects a declaration of an unknown type on save', async () => {
    const { app, workflow } = await setup();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: { name: 'Dials', ...echoGraph(template), settings: [{ key: 'c', type: 'color' }] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('reports bad declarations as workflow issues and runs no turn on them', async () => {
    const { app, workflow, session } = await setup();
    await createWorkflowUpdate(app, workflow.id, [...declarations, { key: 'flag', type: 'text' }]);
    const validation = await app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/validate` });
    expect(validation.statusCode).toBe(422);
    const duplicate = 'More than one chat setting uses the key "flag"; keys must be unique.';
    expect(validation.json().error.details.issues).toEqual([{ message: duplicate }]);
    const turn = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      payload: { content: 'x' },
    });
    expect(turn.statusCode).toBe(400);
    expect(turn.json().error.code).toBe('WORKFLOW_INVALID');
    expect((await read(app, session.id)).messages).toEqual([]);
  });

  it('renders the session settings in a preset preview, and the declared defaults without a session', async () => {
    const { app, session } = await setup();
    await patch(app, session.id, { settings: { mood: 'tense' } });
    const preset = {
      id: randomUUID(),
      name: 'P',
      createdAt: '',
      updatedAt: '',
      inputs: [],
      entries: [
        {
          id: 'e',
          displayName: 'E',
          kind: 'message',
          role: 'system',
          enabled: true,
          content: 'mood={{settings.mood}}',
        },
      ],
    };
    const preview = async (sessionId?: string) =>
      (await app.inject({ method: 'POST', url: '/api/presets/preview', payload: { preset, sessionId } })).json()
        .messages;
    expect(await preview(session.id)).toEqual([{ role: 'system', content: 'mood=tense' }]);
    expect(await preview()).toEqual([{ role: 'system', content: 'mood=calm' }]);
  });
});

describe('settings while a turn streams', () => {
  it('keeps the running turn on its values and applies a change from the next turn', async () => {
    const seen: string[] = [];
    let release!: () => void;
    let gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    useAdapter({
      chat: async () => {
        throw new Error('These tests stream');
      },
      stream: async (request: ChatRequest, { onToken }) => {
        seen.push(request.messages.map((message) => message.content).join('|'));
        entered();
        await gate;
        onToken('done');
        return { text: 'done', raw: {} };
      },
    });
    const directory = join(process.cwd(), '.test-data', `chat-settings-${randomUUID()}`);
    directories.push(directory);
    const app = await createApp(directory, { seed: false });
    apps.push(app);
    await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
    const preset = (
      await app.inject({
        method: 'POST',
        url: '/api/presets',
        payload: {
          name: 'Mood',
          inputs: [],
          entries: [
            {
              id: 'mood',
              displayName: 'Mood',
              kind: 'message',
              role: 'system',
              enabled: true,
              content: 'mood={{settings.mood}}',
            },
          ],
        },
      })
    ).json();
    const workflow = await createWorkflow(app, 'Streamed', declarations, {
      nodes: [
        { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
        {
          id: 'llm',
          type: 'llm',
          config: { presetId: preset.id, provider: 'openrouter', model: 'm' },
          position: { x: 0, y: 0 },
        },
        { id: 'output', type: 'chat-output', config: {}, position: { x: 0, y: 0 } },
      ],
      edges: [{ id: 'e', source: 'llm', sourceHandle: 'text', target: 'output', targetHandle: 'value' }],
    });
    const session = (
      await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })
    ).json();
    const turn = app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages/stream`,
      payload: { content: 'hi' },
    });
    await Promise.race([started, turn.then((response) => Promise.reject(new Error(response.body)))]);
    const changed = await patch(app, session.id, { settings: { mood: 'tense' } });
    expect(changed.statusCode).toBe(200);
    release();
    const frames = parseEventStream((await turn).body).map((frame) => turnEventSchema.parse(frame.data));
    expect(frames.at(-1)).toMatchObject({ type: 'turn.complete', execution: { settings: { mood: 'calm' } } });
    const stored = await read(app, session.id);
    expect(stored.settings).toEqual({ mood: 'tense' });
    expect(stored.messages.map((message) => message.content)).toEqual(['hi', 'done']);
    gate = Promise.resolve();
    await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages/stream`,
      payload: { content: 'again' },
    });
    expect(seen).toEqual(['mood=calm', 'mood=tense']);
  });
});

describe('mergeSettings', () => {
  const workflow = { id: 'w', name: 'W', nodes: [], edges: [], createdAt: '', updatedAt: '', settings: [] };
  it('returns a new object and leaves the stored one alone', () => {
    const stored = Object.freeze({ ghost: 1 });
    expect(mergeSettings(stored, { ghost: null }, [workflow])).toEqual({});
    expect(stored).toEqual({ ghost: 1 });
    expect(mergeSettings(undefined, {}, [workflow])).toEqual({});
  });
});

async function createWorkflowUpdate(app: App, id: string, settings: unknown[]) {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/workflows/${id}`,
    payload: { name: 'Dials', ...echoGraph(template), settings },
  });
  expect(response.statusCode).toBe(200);
}
