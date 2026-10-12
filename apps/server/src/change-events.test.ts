import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { apiContract, type ChangeEvent, type Preset } from '@st/shared';
import { createApp } from './app.js';
import { createContext } from './context.js';
import { registerEvents } from './routes/events.js';

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
const last = (events: ChangeEvent[]) => events[events.length - 1];

it('streams the current state on connect, then a change event per edit with the invalid files', async () => {
  const app = await createApp(dataDir, { seed: false, watch: true });
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const response = await fetch(`${address}/api/events`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const stream = readEvents(response);
    await vi.waitFor(() => expect(stream.events).toHaveLength(1));
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
    await vi.waitFor(() => expect(stream.events).toHaveLength(1));
    const response = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: { name: 'From API', inputs: [], entries: [] },
    });
    expect(response.statusCode).toBe(201);
    await vi.waitFor(() => expect(stream.events.length).toBeGreaterThan(1));
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
  await vi.waitFor(() => expect(first.events).toHaveLength(1));
  await first.cancel();
  await vi.waitFor(() => expect(unsubscribed).toHaveBeenCalledTimes(1));

  // A second client is still connected when the app closes: close must not hang, and the client sees the end.
  const second = readEvents(await fetch(`${address}/api/events`));
  await vi.waitFor(() => expect(second.events).toHaveLength(1));
  await app.close();
  await second.done;
  expect(unsubscribed).toHaveBeenCalledTimes(2);
});

it('closes the watcher with the app, so no timers or handles are left behind', async () => {
  const app = await createApp(dataDir, { seed: false, watch: true });
  await app.close();
  // Writing after close must not throw or trigger a scan of the (possibly removed) directory.
  await writeFile(join(dataDir, 'presets', 'late.yaml'), presetYaml('Late'));
  expect(warn).not.toHaveBeenCalled();
});
