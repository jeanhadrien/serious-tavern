import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type InjectOptions } from 'fastify';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { apiContract, type ChangeEvent, type Preset } from '@st/shared';
import { createApp } from './app.js';
import { createContext } from './context.js';
import { registerEvents } from './routes/events.js';
import { chatResponse, restoreAdapter, useAdapter } from './test-support/adapter.js';

let dataDir: string;
let warn: MockInstance<typeof console.warn>;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'change-events-test-'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  warn.mockRestore();
  await rm(dataDir, { recursive: true, force: true });
});

const presetYaml = (name: string, id = randomUUID()) =>
  `name: ${name}\nid: ${id}\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\n`;

/** Reads an event stream, collecting parsed events as they arrive. */
function readEvents(response: Response) {
  const events: ChangeEvent[] = [];
  const comments: string[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const done = (async () => {
    for (;;) {
      const chunk = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true });
      for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (frame.startsWith(':')) comments.push(frame);
        else
          events.push(
            apiContract.streamChanges.response.parse(
              JSON.parse(
                frame
                  .split('\n')
                  .find((l) => l.startsWith('data: '))!
                  .slice(6),
              ),
            ),
          );
      }
    }
  })();
  return { events, comments, done, cancel: () => reader.cancel() };
}
// The snapshot every new connection starts with: one event per type.
const SNAPSHOT_SIZE = 9;
type PresetsChanged = Extract<ChangeEvent, { type: 'presets.changed' }>;
const last = (events: ChangeEvent[]) =>
  events.filter((event): event is PresetsChanged => event.type === 'presets.changed').at(-1);

it('streams the current state on connect, then a change event per edit with the invalid files', async () => {
  const app = await createApp(dataDir, { seed: false, watch: true });
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const response = await fetch(`${address}/api/events`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const stream = readEvents(response);
    await vi.waitFor(() => expect(stream.events).toHaveLength(SNAPSHOT_SIZE));
    expect(stream.events.map((event) => event.type)).toEqual([
      'presets.changed',
      'providers.changed',
      'collections.changed',
      'stateDefinitions.changed',
      'workflows.changed',
      'characters.changed',
      'personas.changed',
      'sessions.changed',
      'appSettings.changed',
    ]);
    expect(stream.events[0]).toEqual({ type: 'presets.changed', invalidFiles: [] });

    // A hand-written file with broken YAML is reported with its reason, and never modified.
    const broken = join(dataDir, 'presets', 'broken.yaml');
    await writeFile(broken, 'name: [unclosed\n');
    await vi.waitFor(() => expect(last(stream.events)).toMatchObject({ type: 'presets.changed' }));
    await vi.waitFor(() => {
      const event = last(stream.events);
      expect(event?.invalidFiles.map((file) => file.file)).toEqual(['broken.yaml']);
    });
    expect(last(stream.events)?.invalidFiles[0]?.reason).toBeTruthy();

    // Fixing the file clears it from the list.
    await writeFile(broken, presetYaml('Fixed'));
    await vi.waitFor(() => expect(last(stream.events)?.invalidFiles).toEqual([]));

    // The preset is visible through the normal API as soon as the event arrived.
    const list = apiContract.listPresets.response.parse(await (await fetch(`${address}/api/presets`)).json());
    expect(list.map((preset: Preset) => preset.name)).toEqual(['Fixed']);
    await stream.cancel();
  } finally {
    await app.close();
  }
});

it('publishes a change for writes made through the API as well', async () => {
  const app = await createApp(dataDir, { seed: false, watch: true });
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const stream = readEvents(await fetch(`${address}/api/events`));
    await vi.waitFor(() => expect(stream.events).toHaveLength(SNAPSHOT_SIZE));
    const response = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: { name: 'From API', inputs: [], entries: [] },
    });
    expect(response.statusCode).toBe(201);
    await vi.waitFor(() => expect(stream.events.length).toBeGreaterThan(SNAPSHOT_SIZE));
    expect(last(stream.events)).toEqual({ type: 'presets.changed', invalidFiles: [] });
    await stream.cancel();
  } finally {
    await app.close();
  }
});

it('sends keepalive comments on an idle stream', async () => {
  const context = await createContext(dataDir, { seed: false });
  const app = Fastify();
  registerEvents(app, context, { heartbeatMs: 20 });
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const stream = readEvents(await fetch(`${address}/api/events`));
    await vi.waitFor(() => expect(stream.comments).toContain(': keepalive'));
    await stream.cancel();
  } finally {
    await app.close();
  }
});

it('unsubscribes when the client disconnects and ends open streams when the app closes', async () => {
  const context = await createContext(dataDir, { seed: false });
  const unsubscribed = vi.fn();
  const subscribe = context.changes.subscribe.bind(context.changes);
  vi.spyOn(context.changes, 'subscribe').mockImplementation((listener) => {
    const unsubscribe = subscribe(listener);
    return () => {
      unsubscribed();
      unsubscribe();
    };
  });
  const app = Fastify();
  registerEvents(app, context);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });

  const first = readEvents(await fetch(`${address}/api/events`));
  await vi.waitFor(() => expect(first.events).toHaveLength(SNAPSHOT_SIZE));
  await first.cancel();
  await vi.waitFor(() => expect(unsubscribed).toHaveBeenCalledTimes(1));

  // A second client is still connected when the app closes: close must not hang, and the client sees the end.
  const second = readEvents(await fetch(`${address}/api/events`));
  await vi.waitFor(() => expect(second.events).toHaveLength(SNAPSHOT_SIZE));
  await app.close();
  await second.done;
  expect(unsubscribed).toHaveBeenCalledTimes(2);
});

it('closes the watcher with the app, so no timers or handles are left behind', async () => {
  const app = await createApp(dataDir, { seed: false, watch: true });
  await app.close();
  // Writing after close must not throw or trigger a scan of the (possibly removed) directory.
  await writeFile(join(dataDir, 'presets', 'late.yaml'), presetYaml('Late'));
  await writeFile(join(dataDir, 'providers', 'late.yaml'), providerYaml('Late'));
  await writeFile(join(dataDir, 'collections', 'late.yaml'), 'name: Late\n');
  await writeFile(join(dataDir, 'state', 'definitions', 'late.yaml'), 'name: Late\nkeys: {}\n');
  // Longer than the watchers' debounce: a watcher left open would scan and stamp these id-less files.
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(warn).not.toHaveBeenCalled();
  expect(await readFile(join(dataDir, 'providers', 'late.yaml'), 'utf8')).toBe(providerYaml('Late'));
  expect(await readFile(join(dataDir, 'collections', 'late.yaml'), 'utf8')).toBe('name: Late\n');
  expect(await readFile(join(dataDir, 'state', 'definitions', 'late.yaml'), 'utf8')).toBe('name: Late\nkeys: {}\n');
});

const providerYaml = (name: string) => `name: ${name}\nbaseUrl: http://localhost:1234/v1\n`;
const BROKEN_YAML = 'name: [unclosed\n';
type ProvidersChanged = Extract<ChangeEvent, { type: 'providers.changed' }>;
const lastProviders = (events: ChangeEvent[]) =>
  events.filter((event): event is ProvidersChanged => event.type === 'providers.changed').at(-1);

it('announces provider files edited on disk, with the files it could not load', async () => {
  const app = await createApp(dataDir, { seed: false, watch: true });
  try {
    const { stream, events } = await openStream(app);
    expect(lastProviders(stream.events)).toEqual({ type: 'providers.changed', invalidFiles: [] });

    const broken = join(dataDir, 'providers', 'broken.yaml');
    await writeFile(broken, BROKEN_YAML);
    await vi.waitFor(() =>
      expect(lastProviders(events())?.invalidFiles.map((file) => file.file)).toEqual(['broken.yaml']),
    );

    // A hand-written provider without id is stamped and listed; fixing the broken file clears the warning.
    await writeFile(broken, providerYaml('Local'));
    await vi.waitFor(() => expect(lastProviders(events())?.invalidFiles).toEqual([]));
    const list = apiContract.listProviders.response.parse((await app.inject({ url: '/api/providers' })).json());
    expect(list.filter((provider) => !provider.builtIn).map((provider) => provider.name)).toEqual(['Local']);
    await stream.cancel();
  } finally {
    await app.close();
  }
});

it('announces provider writes made through the API, keeping invalid files listed', async () => {
  // No watcher: the API itself must announce.
  const app = await createApp(dataDir, { seed: false });
  try {
    await mkdir(join(dataDir, 'providers'), { recursive: true });
    await writeFile(join(dataDir, 'providers', 'broken.yaml'), BROKEN_YAML);
    const { stream, events } = await openStream(app);
    const invalid = [{ file: 'broken.yaml', reason: expect.any(String) }];
    const write = async (request: InjectOptions, status: number) => {
      const before = events().length;
      const response = await app.inject(request);
      expect(response.statusCode).toBe(status);
      if (status < 300) await vi.waitFor(() => expect(events().length).toBe(before + 1));
      return response.body ? (response.json() as { id: string }) : undefined;
    };
    const body = { name: 'Mine', baseUrl: 'http://localhost:1234/v1' };
    const created = await write({ method: 'POST', url: '/api/providers', payload: body }, 201);
    await write({ method: 'PUT', url: `/api/providers/${created!.id}`, payload: { ...body, name: 'Renamed' } }, 200);
    await write({ method: 'POST', url: '/api/providers/openrouter/duplicate' }, 201);
    await write({ method: 'DELETE', url: `/api/providers/${created!.id}` }, 204);
    expect(events()).toHaveLength(4);
    for (const event of events()) expect(event).toEqual({ type: 'providers.changed', invalidFiles: invalid });

    // A refused delete (read-only) announces nothing.
    await write({ method: 'DELETE', url: '/api/providers/openrouter' }, 409);
    await settle();
    expect(events()).toHaveLength(4);
    await stream.cancel();
  } finally {
    await app.close();
  }
});

type App = Awaited<ReturnType<typeof createApp>>;

/** Opens an event stream on the app; `events()` returns what arrived after the connect snapshot. */
async function openStream(app: App) {
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const stream = readEvents(await fetch(`${address}/api/events`));
  await vi.waitFor(() => expect(stream.events).toHaveLength(SNAPSHOT_SIZE));
  return { stream, events: () => stream.events.slice(SNAPSHOT_SIZE) };
}
const created = async (app: App, url: string, payload: object) =>
  (await app.inject({ method: 'POST', url, payload })).json() as { id: string };
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

it('publishes a change for every write to workflows, characters, personas and sessions', async () => {
  const app = await createApp(dataDir, { seed: false });
  try {
    const { stream, events } = await openStream(app);
    // Each step performs one write, then waits until exactly the events so far have arrived.
    const expected: ChangeEvent[] = [];
    const step = async (request: InjectOptions, event: ChangeEvent) => {
      const response = await app.inject(request);
      expect(response.statusCode).toBeLessThan(300);
      expected.push(event);
      await vi.waitFor(() => expect(events()).toEqual(expected));
    };
    const workflow = await created(app, '/api/workflows', { name: 'W' });
    expected.push({ type: 'workflows.changed', id: workflow.id });
    const character = await created(app, '/api/characters', { name: 'C' });
    expected.push({ type: 'characters.changed', id: character.id });
    const persona = await created(app, '/api/personas', { name: 'P' });
    expected.push({ type: 'personas.changed', id: persona.id });
    const session = await created(app, '/api/sessions', { workflowId: workflow.id });
    expected.push({ type: 'sessions.changed', id: session.id });
    await vi.waitFor(() => expect(events()).toEqual(expected));

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
      'base64',
    );
    await step(
      { method: 'PUT', url: `/api/workflows/${workflow.id}`, payload: { name: 'W2', nodes: [], edges: [] } },
      { type: 'workflows.changed', id: workflow.id },
    );
    await step(
      { method: 'PUT', url: `/api/characters/${character.id}`, payload: { name: 'C2' } },
      { type: 'characters.changed', id: character.id },
    );
    await step(
      {
        method: 'PUT',
        url: `/api/characters/${character.id}/avatar`,
        headers: { 'content-type': 'image/png' },
        payload: png,
      },
      { type: 'characters.changed', id: character.id },
    );
    await step(
      { method: 'PUT', url: `/api/personas/${persona.id}`, payload: { name: 'P2' } },
      { type: 'personas.changed', id: persona.id },
    );
    await step(
      { method: 'PATCH', url: `/api/sessions/${session.id}`, payload: { name: 'Renamed' } },
      { type: 'sessions.changed', id: session.id },
    );
    await step({ method: 'DELETE', url: `/api/sessions/${session.id}` }, { type: 'sessions.changed', id: session.id });
    await step(
      { method: 'DELETE', url: `/api/characters/${character.id}` },
      { type: 'characters.changed', id: character.id },
    );
    await step({ method: 'DELETE', url: `/api/personas/${persona.id}` }, { type: 'personas.changed', id: persona.id });
    await step(
      { method: 'DELETE', url: `/api/workflows/${workflow.id}` },
      { type: 'workflows.changed', id: workflow.id },
    );

    await step(
      { method: 'PATCH', url: '/api/app-settings', payload: { showMessageStats: true } },
      { type: 'appSettings.changed' },
    );

    // A failed write changes nothing and announces nothing.
    const refused = await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: { showMessageStats: 'x' } });
    expect(refused.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'PUT',
      url: '/api/personas/00000000-0000-4000-8000-000000000000',
      payload: { name: 'x' },
    });
    expect(missing.statusCode).toBe(404);
    await settle();
    expect(events()).toEqual(expected);
    await stream.cancel();
  } finally {
    await app.close();
  }
});

it('publishes one session event per settled streamed turn, and one per message edit and delete', async () => {
  const provider = 'openrouter';
  useAdapter({
    chat: async () => {
      throw new Error('These tests stream');
    },
    stream: async (_request, { onToken }) => {
      for (const token of ['a', 'b', 'c', 'd']) onToken(token);
      await new Promise((resolve) => setTimeout(resolve, 400)); // long enough for a periodic flush
      return chatResponse('abcd');
    },
  });
  const app = await createApp(dataDir, { seed: false });
  try {
    await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'k' } });
    const preset = await created(app, '/api/presets', { name: 'P', inputs: [], entries: [] });
    const workflow = await created(app, '/api/workflows', { name: 'W' });
    const node = (id: string, type: string, config = {}) => ({ id, type, config, position: { x: 0, y: 0 } });
    await app.inject({
      method: 'PUT',
      url: `/api/workflows/${workflow.id}`,
      payload: {
        name: 'W',
        nodes: [
          node('input', 'chat-input'),
          node('llm', 'llm', { presetId: preset.id, provider, model: 'm' }),
          node('output', 'chat-output'),
        ],
        edges: [{ id: 'e', source: 'llm', sourceHandle: 'text', target: 'output', targetHandle: 'value' }],
      },
    });
    const session = await created(app, '/api/sessions', { workflowId: workflow.id });
    const { stream, events } = await openStream(app);

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages/stream`,
      payload: { content: 'hi' },
    });
    expect(response.body).toContain('turn.complete');
    await vi.waitFor(() => expect(events()).not.toHaveLength(0));
    await settle();
    expect(events()).toEqual([{ type: 'sessions.changed', id: session.id }]);

    // Editing and deleting a message change content without advancing updatedAt; clients still hear about them.
    const { messages } = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    const messageUrl = `/api/sessions/${session.id}/messages/${messages[0].id}`;
    await app.inject({ method: 'PATCH', url: messageUrl, payload: { content: 'edited' } });
    await vi.waitFor(() => expect(events()).toHaveLength(2));
    await app.inject({ method: 'DELETE', url: messageUrl });
    await vi.waitFor(() => expect(events()).toHaveLength(3));
    await stream.cancel();
  } finally {
    restoreAdapter();
    await app.close();
  }
});

type CollectionsChanged = Extract<ChangeEvent, { type: 'collections.changed' }>;
const collectionEvents = (events: ChangeEvent[]) =>
  events.filter((event): event is CollectionsChanged => event.type === 'collections.changed');

it('announces collection files edited on disk, with the files it could not load', async () => {
  const app = await createApp(dataDir, { seed: false, watch: true });
  try {
    const { stream, events } = await openStream(app);
    expect(collectionEvents(stream.events)).toEqual([{ type: 'collections.changed', invalidFiles: [] }]);

    const broken = join(dataDir, 'collections', 'broken.yaml');
    await writeFile(broken, 'name: Lore\nentries:\n  - title: no text\n');
    await vi.waitFor(() =>
      expect(collectionEvents(events()).at(-1)?.invalidFiles).toEqual([
        { file: 'broken.yaml', reason: expect.stringContaining('invalid collection: entries.0.text') },
      ]),
    );

    // Fixing the file clears the warning, and the (stamped) collection is listed.
    await writeFile(broken, 'name: Lore\nentries:\n  - text: fixed\n');
    await vi.waitFor(() => expect(collectionEvents(events()).at(-1)?.invalidFiles).toEqual([]));
    const list = apiContract.listCollections.response.parse((await app.inject({ url: '/api/collections' })).json());
    expect(list.map((collection) => [collection.name, collection.entryCount])).toEqual([['Lore', 1]]);
    await stream.cancel();
  } finally {
    await app.close();
  }
});

type DefinitionsChanged = Extract<ChangeEvent, { type: 'stateDefinitions.changed' }>;
const definitionEvents = (events: ChangeEvent[]) =>
  events.filter((event): event is DefinitionsChanged => event.type === 'stateDefinitions.changed');

it('announces state definition files edited on disk, with the files it could not load', async () => {
  const app = await createApp(dataDir, { seed: false, watch: true });
  try {
    const { stream, events } = await openStream(app);
    expect(definitionEvents(stream.events)).toEqual([{ type: 'stateDefinitions.changed', invalidFiles: [] }]);

    const broken = join(dataDir, 'state', 'definitions', 'broken.yaml');
    await writeFile(broken, 'name: scene\nkeys:\n  tension:\n    type: date\n');
    await vi.waitFor(() =>
      expect(definitionEvents(events()).at(-1)?.invalidFiles).toEqual([
        { file: 'broken.yaml', reason: expect.stringContaining('invalid state definition: keys.tension.type') },
      ]),
    );

    // Fixing the file clears the warning, and the (stamped) definition is listed.
    await writeFile(broken, 'name: scene\nkeys:\n  tension:\n    type: number\n');
    await vi.waitFor(() => expect(definitionEvents(events()).at(-1)?.invalidFiles).toEqual([]));
    const list = apiContract.listStateDefinitions.response.parse(
      (await app.inject({ url: '/api/state-definitions' })).json(),
    );
    expect(list.map((definition) => [definition.name, Object.keys(definition.keys)])).toEqual([['scene', ['tension']]]);
    await stream.cancel();
  } finally {
    await app.close();
  }
});

it('announces state definition writes made through the API, keeping invalid files listed', async () => {
  // No watcher: the API itself must announce.
  const app = await createApp(dataDir, { seed: false });
  try {
    await mkdir(join(dataDir, 'state', 'definitions'), { recursive: true });
    await writeFile(join(dataDir, 'state', 'definitions', 'broken.yaml'), BROKEN_YAML);
    const { stream, events } = await openStream(app);
    const announced = () => definitionEvents(events());
    const write = async (request: InjectOptions, status: number) => {
      const before = announced().length;
      const response = await app.inject(request);
      expect(response.statusCode).toBe(status);
      if (status < 300) await vi.waitFor(() => expect(announced().length).toBe(before + 1));
      return response.body ? (response.json() as { id: string }) : undefined;
    };
    const body = { name: 'scene', keys: { tension: { type: 'number' } } };
    const definition = await write({ method: 'POST', url: '/api/state-definitions', payload: body }, 201);
    await write(
      { method: 'PUT', url: `/api/state-definitions/${definition!.id}`, payload: { ...body, name: 'mood' } },
      200,
    );
    // A refused write (name taken) announces nothing.
    await write({ method: 'POST', url: '/api/state-definitions', payload: { ...body, name: 'MOOD' } }, 409);
    await settle();
    expect(announced()).toHaveLength(2);
    await write({ method: 'DELETE', url: `/api/state-definitions/${definition!.id}` }, 204);
    expect(announced()).toHaveLength(3);
    for (const event of announced())
      expect(event).toEqual({
        type: 'stateDefinitions.changed',
        invalidFiles: [{ file: 'broken.yaml', reason: expect.any(String) }],
      });
    await stream.cancel();
  } finally {
    await app.close();
  }
});

it('announces collection writes made through the API, keeping invalid files listed', async () => {
  // No watcher: the API itself must announce.
  const app = await createApp(dataDir, { seed: false });
  try {
    await mkdir(join(dataDir, 'collections'), { recursive: true });
    await writeFile(join(dataDir, 'collections', 'broken.yaml'), BROKEN_YAML);
    const { stream, events } = await openStream(app);
    const announced = () => collectionEvents(events());
    const write = async (request: InjectOptions, status: number) => {
      const before = announced().length;
      const response = await app.inject(request);
      expect(response.statusCode).toBe(status);
      if (status < 300) await vi.waitFor(() => expect(announced().length).toBe(before + 1));
      return response.body ? (response.json() as { id: string }) : undefined;
    };
    const body = { name: 'Lore', entries: [{ text: 'a' }] };
    const collection = await write({ method: 'POST', url: '/api/collections', payload: body }, 201);
    await write(
      { method: 'PUT', url: `/api/collections/${collection!.id}`, payload: { ...body, name: 'Renamed' } },
      200,
    );
    expect(announced()).toEqual([
      { type: 'collections.changed', invalidFiles: [{ file: 'broken.yaml', reason: expect.any(String) }] },
      { type: 'collections.changed', invalidFiles: [{ file: 'broken.yaml', reason: expect.any(String) }] },
    ]);

    // A refused delete (in use) announces nothing.
    const workflow = await created(app, '/api/workflows', {
      name: 'Reader',
      nodes: [{ id: 'r', type: 'recall', position: { x: 0, y: 0 }, config: { collectionIds: [collection!.id] } }],
      edges: [],
    });
    await write({ method: 'DELETE', url: `/api/collections/${collection!.id}` }, 409);
    await settle();
    expect(announced()).toHaveLength(2);

    await app.inject({ method: 'DELETE', url: `/api/workflows/${workflow.id}` });
    await write({ method: 'DELETE', url: `/api/collections/${collection!.id}` }, 204);
    expect(announced()).toHaveLength(3);
    expect(announced()[2]?.invalidFiles.map((file) => file.file)).toEqual(['broken.yaml']);
    await stream.cancel();
  } finally {
    await app.close();
  }
});
