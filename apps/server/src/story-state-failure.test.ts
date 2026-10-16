import { afterEach, describe, expect, it } from 'vitest';
import { apiContract, errorEnvelopeSchema, turnEventSchema } from '@st/shared';
import type { ChatRequest, StreamOptions } from '@st/engine';
import { restoreAdapter, useAdapter } from './test-support/adapter.js';
import { parseEventStream } from './test-support/event-stream.js';
import {
  assistantRows,
  counting,
  define,
  edge,
  entriesOf,
  makeSession,
  makeWorkflow,
  node,
  putWorkflow,
  readSession,
  send,
  tempApps,
  turn,
} from './test-support/story.js';

const apps = tempApps('story-failure');
afterEach(async () => {
  restoreAdapter();
  await apps.cleanup();
});

async function waitFor<T>(read: () => Promise<T | undefined>, attempts = 200): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the condition');
}

describe('story state of failed and stopped turns', () => {
  it('keeps the writes of the nodes that completed, and the replies, when a later node fails', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const bump = node('bump', 'state-write', { definitionId: definition.id, key: 'n', op: 'increment' });
      // Wave 0: input and bump. Wave 1: the reply and the condition. Wave 2: parse-json fails on "hello".
      const failing = await makeWorkflow(
        app,
        [
          node('input', 'chat-input'),
          bump,
          node('first', 'chat-output', { template: 'n={{state.counter.n}} turn={{trigger.turn}}' }),
          node('gate', 'condition', { left: '{{input.value}}', operator: 'isNotEmpty' }),
          node('parse', 'parse-json'),
          node('second', 'chat-output'),
        ],
        [
          edge('input', 'message', 'first', 'value'),
          edge('input', 'message', 'gate', 'value'),
          edge('gate', 'true', 'parse', 'text'),
          edge('parse', 'value', 'second', 'value'),
        ],
      );
      const session = await makeSession(app, failing.id);
      const response = await send(app, session.id, 'hello');
      expect(response.statusCode).toBe(500);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('WORKFLOW_EXECUTION_FAILED');
      const saved = await readSession(app, session.id);
      expect(assistantRows(saved).map((row) => row.content)).toEqual(['n=0 turn=1']);
      const [entry] = entriesOf(saved);
      expect(entriesOf(saved)).toHaveLength(1);
      expect(entry).toMatchObject({ completed: false, replies: 1 });
      expect(entry!.writes).toEqual([
        { op: 'set', target: { kind: 'definition', definitionId: definition.id, key: 'n' }, nodeId: 'bump', value: 1 },
      ]);
      // The partial reply keeps the turn present: it is counted and its write applies.
      const fixed = counting(definition.id, false);
      await putWorkflow(app, failing.id, fixed.nodes, fixed.edges);
      expect(await turn(app, session.id, 'hello')).toEqual(['n=1 turn=2']);
    } finally {
      await app.close();
    }
  });

  it('records a failed turn that produced no reply, but it does not count and its writes do not apply', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const failing = await makeWorkflow(
        app,
        [
          node('input', 'chat-input'),
          node('bump', 'state-write', { definitionId: definition.id, key: 'n', op: 'increment' }),
          node('parse', 'parse-json'),
          node('output', 'chat-output'),
        ],
        [edge('input', 'message', 'parse', 'text'), edge('parse', 'value', 'output', 'value')],
      );
      const session = await makeSession(app, failing.id);
      expect((await send(app, session.id, 'hello')).statusCode).toBe(500);
      const saved = await readSession(app, session.id);
      expect(assistantRows(saved)).toEqual([]);
      expect(entriesOf(saved)).toMatchObject([{ completed: false, replies: 0, writes: [{ op: 'set', value: 1 }] }]);
      const fixed = counting(definition.id, true);
      await putWorkflow(app, failing.id, fixed.nodes, fixed.edges);
      // The failed turn is not counted: this is turn 1, and n is still the default.
      expect(await turn(app, session.id)).toEqual(['n=0 turn=1']);
      expect(entriesOf(await readSession(app, session.id))).toHaveLength(2);
      expect(await turn(app, session.id)).toEqual(['n=1 turn=2']);
    } finally {
      await app.close();
    }
  });

  it('keeps the writes of a stopped turn that left a partial reply', async () => {
    useAdapter({
      chat: async () => {
        throw new Error('These tests stream');
      },
      stream: async (_request: ChatRequest, { onToken, signal }: StreamOptions) => {
        onToken('Par');
        await new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('upstream aborted')), { once: true }),
        );
        throw new Error('unreachable');
      },
    });
    const { app } = await apps.open();
    try {
      await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
      const definition = await define(app);
      const preset = (
        await app.inject({ method: 'POST', url: '/api/presets', payload: { name: 'Stop', inputs: [], entries: [] } })
      ).json();
      const workflow = await makeWorkflow(
        app,
        [
          node('input', 'chat-input'),
          node('bump', 'state-write', { definitionId: definition.id, key: 'n', op: 'increment' }),
          node('llm', 'llm', { presetId: preset.id, provider: 'openrouter', model: 'stop-model' }),
          node('output', 'chat-output'),
        ],
        [edge('llm', 'text', 'output', 'value')],
      );
      const session = await makeSession(app, workflow.id);
      const running = app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/messages/stream`,
        payload: { content: 'hi' },
      });
      await waitFor(async () =>
        assistantRows(await readSession(app, session.id)).find((message) => message.content === 'Par'),
      );
      expect((await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` })).statusCode).toBe(204);
      const frames = parseEventStream((await running).body).map((frame) => turnEventSchema.parse(frame.data));
      expect(frames.at(-1)).toMatchObject({ type: 'turn.error', error: { code: 'TURN_STOPPED' } });
      const saved = await readSession(app, session.id);
      expect(assistantRows(saved)).toMatchObject([{ content: 'Par', status: 'partial' }]);
      expect(entriesOf(saved)).toMatchObject([
        { completed: false, replies: 1, writes: [{ op: 'set', nodeId: 'bump', value: 1 }] },
      ]);
    } finally {
      await app.close();
    }
  });

  it('appends the same entry when the turn is streamed', async () => {
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const { nodes, edges } = counting(definition.id);
      const workflow = await makeWorkflow(app, nodes, edges);
      const session = await makeSession(app, workflow.id);
      const response = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/messages/stream`,
        payload: { content: 'hi' },
      });
      const frames = parseEventStream(response.body).map((frame) => turnEventSchema.parse(frame.data));
      const done = frames.at(-1)!;
      expect(done.type).toBe('turn.complete');
      const saved = await readSession(app, session.id);
      expect(assistantRows(saved).map((row) => row.content)).toEqual(['n=0 turn=1']);
      expect(entriesOf(saved)).toMatchObject([
        { completed: true, replies: 1, writes: [{ op: 'set', value: 1, nodeId: 'bump' }] },
      ]);
      expect(entriesOf(saved)[0]!.executionId).toBe(assistantRows(saved)[0]!.executionId);
      // The next turn of either transport sees it.
      expect(await turn(app, session.id)).toEqual(['n=1 turn=2']);
      apiContract.getSession.response.parse(
        (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json(),
      );
    } finally {
      await app.close();
    }
  });
});
