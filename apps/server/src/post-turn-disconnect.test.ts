import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientsGone, postHarness, waitFor, waitForPostRun, watchQueue } from './test-support/post.js';
import {
  assistantRows,
  edge,
  entriesOf,
  makeSession,
  makeWorkflow,
  node,
  readSession,
  send,
  turn,
  type App,
} from './test-support/story.js';

// A client that leaves cancels its message while it waits in the queue; a plain request that already runs finishes.

const harness = postHarness('post-turn-disconnect');
const listening: App[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  // fetch keeps its connection alive, which would make `app.close()` wait for the idle timeout.
  for (const app of listening.splice(0)) app.server.closeAllConnections();
  await harness.cleanup();
});

const contents = async (app: App, sessionId: string) =>
  (await readSession(app, sessionId)).messages.map((message) => message.content);

async function listen(app: App) {
  await app.listen({ port: 0, host: '127.0.0.1' });
  listening.push(app);
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}
const post = (url: string, content: string, signal: AbortSignal) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    signal,
  }).catch((error: unknown) => error);

describe('a message waiting behind a post run', () => {
  it.each([
    ['stream', '/messages/stream'],
    ['plain', '/messages'],
  ] as const)(
    'is cancelled when its client leaves (%s endpoint): nothing of it is stored and the next message goes on',
    async (_name, path) => {
      const { app, session, gate } = await harness.setup();
      const base = await listen(app);
      const queue = watchQueue();
      await send(app, session.id, 'one');
      await gate.started;
      const leaving = new AbortController();
      const queued = post(`${base}/api/sessions/${session.id}${path}`, 'two', leaving.signal);
      // The request has reached the turn queue (`one` was the first job) and waits behind the post run.
      await queue.reached(2);
      expect(await contents(app, session.id)).toEqual(['one', 'n=0 turn=1']);
      leaving.abort();
      expect(await queued).toBeInstanceOf(Error);
      // The server has seen the client go before the run lets the message start.
      await clientsGone(app);
      gate.release();
      await waitForPostRun(app, session.id, 'completed');
      // The cancelled message went through the queue without running: `three` is turn 2 and sees the post writes.
      expect(await turn(app, session.id, 'three')).toEqual(['n=2 turn=2']);
      expect(await contents(app, session.id)).toEqual(['one', 'n=0 turn=1', 'three', 'n=2 turn=2']);
    },
  );
});

describe('a plain request that already runs', () => {
  it('finishes when its client leaves', async () => {
    const { app, definition } = await harness.bare();
    const gate = harness.gate();
    const wf = await makeWorkflow(
      app,
      [node('input', 'chat-input'), node('gate', 'post-gate-test'), node('output', 'chat-output')],
      [edge('input', 'message', 'gate', 'value'), edge('gate', 'value', 'output', 'value')],
      `Held reply ${definition.name}`,
    );
    const base = await listen(app);
    const plain = await makeSession(app, wf.id);
    const leaving = new AbortController();
    const running = post(`${base}/api/sessions/${plain.id}/messages`, 'hi', leaving.signal);
    await gate.started;
    leaving.abort();
    await running;
    await clientsGone(app);
    gate.release();
    const saved = await waitFor(async () => {
      const session = await readSession(app, plain.id);
      return assistantRows(session).length ? session : undefined;
    });
    expect(assistantRows(saved).map((row) => row.content)).toEqual(['hi']);
    expect(entriesOf(saved)[0]).toMatchObject({ completed: true, replies: 1 });
  });
});
