import { afterEach, describe, expect, it, vi } from 'vitest';
import { turnEventSchema } from '@st/shared';
import type { ChatRequest, StreamOptions } from '@st/engine';
import { restoreAdapter, useAdapter } from './test-support/adapter.js';
import {
  afterReplyWorkflow,
  gateNode,
  postHarness,
  postRunOf,
  stateView,
  waitFor,
  waitForPostRun,
  watchQueue,
} from './test-support/post.js';
import {
  assistantRows,
  edge,
  entriesOf,
  makeSession,
  makeWorkflow,
  node,
  readExecution,
  readSession,
  send,
  turn,
} from './test-support/story.js';
import { parseEventStream } from './test-support/event-stream.js';

// Ordering, Stop and failure of the post run: it holds the chat's queue slot and never touches the reply.

const harness = postHarness('post-turn-queue');
const { setup } = harness;
afterEach(async () => {
  vi.restoreAllMocks();
  restoreAdapter();
  await harness.cleanup();
});

const pause = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
const stop = (app: Awaited<ReturnType<typeof setup>>['app'], sessionId: string) =>
  app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/stop` });

describe('the next message', () => {
  it('waits for the post run of the previous turn and then sees its writes', async () => {
    const { app, session, gate } = await setup();
    const queue = watchQueue();
    await send(app, session.id, 'one');
    await gate.started;
    const second = send(app, session.id, 'two');
    await queue.reached(2);
    // Give a message that wrongly started time to show: it has not, nothing of it is stored, and the post run is
    // still the only run.
    await pause();
    expect((await readSession(app, session.id)).messages.map((message) => message.content)).toEqual([
      'one',
      'n=0 turn=1',
    ]);
    expect(gate.runs).toBe(1);
    gate.release();
    const response = await second;
    expect(response.statusCode).toBe(200);
    expect((await readSession(app, session.id)).messages.map((message) => message.content)).toEqual([
      'one',
      'n=0 turn=1',
      'two',
      'n=2 turn=2',
    ]);
    await waitFor(async () => {
      const view = await stateView(app, session.id);
      return view.turns.length === 2 && view.turns.every((item) => item.postStatus === 'completed') ? view : undefined;
    });
  });

  it('waits too when it was queued before the first reply was settled', async () => {
    const { app, session, gate } = await setup();
    const queue = watchQueue();
    const first = send(app, session.id, 'one');
    const second = send(app, session.id, 'two');
    await queue.reached(2);
    expect((await first).statusCode).toBe(200);
    await gate.started;
    await pause();
    expect(assistantRows(await readSession(app, session.id))).toHaveLength(1);
    expect(gate.runs).toBe(1);
    gate.release();
    expect((await second).statusCode).toBe(200);
    expect(assistantRows(await readSession(app, session.id)).map((row) => row.content)).toEqual([
      'n=0 turn=1',
      'n=2 turn=2',
    ]);
  });

  it('is not delayed by the post run of another chat', async () => {
    const { app, session, gate, workflow } = await setup();
    await send(app, session.id);
    await gate.started;
    const other = await makeSession(app, workflow.id);
    expect(await turn(app, other.id)).toEqual(['n=0 turn=1']);
    expect((await postRunOf(app, session.id)).postStatus).toBe('running');
  });
});

describe('Stop', () => {
  it('stops the post run, keeps the writes of the nodes that finished, and leaves the reply alone', async () => {
    const { app, session, gate } = await setup();
    await send(app, session.id);
    await gate.started;
    const before = assistantRows(await readSession(app, session.id));
    expect((await stop(app, session.id)).statusCode).toBe(204);
    const stopped = await waitForPostRun(app, session.id, 'stopped');
    expect(stopped.postError).toBeUndefined();
    const post = await readExecution(app, stopped.postExecutionId!);
    expect(post).toMatchObject({ part: 'post', status: 'error', turnExecutionId: before[0]!.executionId });
    expect(post.warnings).toContain('The after-reply run was stopped by the user before it finished.');
    expect(post.nodes.gate?.status).toBe('cancelled');
    const saved = await readSession(app, session.id);
    expect(entriesOf(saved)[0]).toMatchObject({ completed: true, replies: 1 });
    expect(entriesOf(saved)[0]!.writes.map((write) => write.nodeId)).toEqual(['bump', 'postBump']);
    expect(assistantRows(saved)).toEqual(before);
    // Nothing runs now, and the chat goes on.
    expect((await stop(app, session.id)).statusCode).toBe(204);
    expect(await turn(app, session.id)).toEqual(['n=2 turn=2']);
  });
});

describe('a failing post run', () => {
  it('is an error on the entry and nothing else: the reply, the turn and the queue are fine', async () => {
    const { app, session, gate } = await setup();
    await send(app, session.id);
    await gate.started;
    const before = await readSession(app, session.id);
    gate.fail('boom');
    const failed = await waitForPostRun(app, session.id, 'error');
    expect(failed.postError).toBe('Post Gate (gate): boom');
    const saved = await readSession(app, session.id);
    expect(saved.messages).toEqual(before.messages);
    expect(entriesOf(saved)[0]).toMatchObject({ completed: true, replies: 1, postStatus: 'error' });
    expect(entriesOf(saved)[0]!.writes.map((write) => write.nodeId)).toEqual(['bump', 'postBump']);
    const post = await readExecution(app, failed.postExecutionId!);
    expect(post).toMatchObject({ status: 'error', part: 'post' });
    expect(post.nodes.gate).toMatchObject({ status: 'error', error: 'boom' });
    expect(await turn(app, session.id)).toEqual(['n=2 turn=2']);
  });

  it('cuts a long error to 500 characters on the entry and keeps it whole in the log', async () => {
    const { app, session, gate } = await setup();
    await send(app, session.id);
    await gate.started;
    gate.fail('x'.repeat(2000));
    const failed = await waitForPostRun(app, session.id, 'error');
    expect(failed.postError).toHaveLength(500);
    expect((await readExecution(app, failed.postExecutionId!)).nodes.gate?.error).toBe('x'.repeat(2000));
  });
});

describe('a reply that did not finish', () => {
  // The same after-reply work behind a different reply: a plain Chat Output (so it streams) fed by `reply`.
  const withReply = (definitionId: string, reply: object[], replyEdges: object[]) => {
    const { nodes, edges } = afterReplyWorkflow(definitionId, true);
    return {
      nodes: [...nodes.filter((item) => item.id !== 'output'), node('output', 'chat-output'), ...reply],
      edges: [...edges.filter((item) => item.source !== 'input'), ...replyEdges],
    };
  };

  it('leaves no post run when the reply failed', async () => {
    const { app, definition } = await harness.bare();
    const gate = gateNode();
    try {
      const { nodes, edges } = withReply(
        definition.id,
        [node('parse', 'parse-json')],
        [edge('input', 'message', 'parse', 'text'), edge('parse', 'value', 'output', 'value')],
      );
      const session = await makeSession(app, (await makeWorkflow(app, nodes, edges)).id);
      expect((await send(app, session.id, 'not json')).statusCode).toBe(500);
      const [entry] = entriesOf(await readSession(app, session.id));
      expect(entry).toMatchObject({ completed: false });
      expect(entry!.postExecutionId).toBeUndefined();
      expect(entry!.postStatus).toBeUndefined();
      expect(gate.runs).toBe(0);
      expect((await stateView(app, session.id)).turns[0]!.postStatus).toBeUndefined();
    } finally {
      gate.dispose();
    }
  });

  it('leaves no post run when the reply was stopped', async () => {
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
    const { app, definition } = await harness.bare();
    const gate = gateNode();
    try {
      await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
      const preset = (
        await app.inject({ method: 'POST', url: '/api/presets', payload: { name: 'Stop', inputs: [], entries: [] } })
      ).json();
      const { nodes, edges } = withReply(
        definition.id,
        [node('llm', 'llm', { presetId: preset.id, provider: 'openrouter', model: 'stop-model' })],
        [edge('llm', 'text', 'output', 'value')],
      );
      const session = await makeSession(app, (await makeWorkflow(app, nodes, edges)).id);
      const running = app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/messages/stream`,
        payload: { content: 'hi' },
      });
      await waitFor(async () =>
        assistantRows(await readSession(app, session.id)).find((message) => message.content === 'Par'),
      );
      expect((await stop(app, session.id)).statusCode).toBe(204);
      const frames = parseEventStream((await running).body).map((frame) => turnEventSchema.parse(frame.data));
      expect(frames.at(-1)).toMatchObject({ type: 'turn.error', error: { code: 'TURN_STOPPED' } });
      const [entry] = entriesOf(await readSession(app, session.id));
      expect(entry).toMatchObject({ completed: false, replies: 1 });
      expect(entry!.postStatus).toBeUndefined();
      expect(gate.runs).toBe(0);
    } finally {
      gate.dispose();
    }
  });
});
