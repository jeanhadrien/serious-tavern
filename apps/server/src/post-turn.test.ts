import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiContract, errorEnvelopeSchema, turnEventSchema } from '@st/shared';
import { ChangeHub } from './services/change-events.js';
import { parseEventStream } from './test-support/event-stream.js';
import { postHarness, postRunOf, stateView, waitFor, waitForPostRun } from './test-support/post.js';
import {
  counting,
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

// A workflow with After Reply runs its post part as a second run after the turn settles.

const harness = postHarness('post-turn');
const { bare, setup } = harness;
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

const sendResult = (response: { json(): unknown }) => apiContract.sendMessage.response.parse(response.json());

describe('a workflow without After Reply', () => {
  it('runs no post run and leaves the entry as it was', async () => {
    const { app, directory, definition } = await bare();
    const { nodes, edges } = counting(definition.id);
    const session = await makeSession(app, (await makeWorkflow(app, nodes, edges)).id);
    expect(await turn(app, session.id)).toEqual(['n=0 turn=1']);
    const raw = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    for (const field of ['postExecutionId', 'postStatus', 'postError'])
      expect(raw.state.turns[0]).not.toHaveProperty(field);
    expect(await postRunOf(app, session.id)).toEqual({});
    expect(await readdir(join(directory, 'executions'))).toHaveLength(1);
  });
});

describe('the post run of a turn', () => {
  it('starts after the reply is delivered, with its own log linked to the turn', async () => {
    const { app, session, gate } = await setup();
    const response = await send(app, session.id);
    expect(response.statusCode).toBe(200);
    const result = sendResult(response);
    await gate.started;
    // The reply is complete while the post run is held; the entry says so, and so does the state view.
    expect(result.assistantMessages.map((message) => message.content)).toEqual(['n=0 turn=1']);
    const [entry] = entriesOf(await readSession(app, session.id));
    expect(entry).toMatchObject({ completed: true, replies: 1, postStatus: 'running' });
    expect(await postRunOf(app, session.id)).toEqual({
      postStatus: 'running',
      postExecutionId: entry!.postExecutionId,
    });
    // The reply log shows the after-reply nodes as not run.
    const nodes = result.execution.nodes;
    expect([nodes.after, nodes.postBump, nodes.postAdd, nodes.gate].map((item) => item?.status)).toEqual(
      Array(4).fill('skipped'),
    );
    expect(nodes.bump?.status).toBe('completed');

    gate.release();
    const done = await waitForPostRun(app, session.id, 'completed');
    expect(done.postExecutionId).toBe(entry!.postExecutionId);
    const post = await readExecution(app, done.postExecutionId!);
    expect(post).toMatchObject({
      part: 'post',
      status: 'completed',
      turnExecutionId: result.execution.id,
      seed: `${result.execution.seed}:post`,
      settings: result.execution.settings,
    });
    expect(Object.keys(post.nodes).sort()).toEqual(['after', 'gate', 'postAdd', 'postBump']);
    // The reply and its log are untouched.
    expect((await readSession(app, session.id)).messages.map((message) => message.content)).toEqual([
      'go',
      'n=0 turn=1',
    ]);
    expect((await readExecution(app, result.execution.id)).part).toBeUndefined();
  });

  it('does not hold the stream open: it ends with turn.complete while the post run runs', async () => {
    const { app, session, gate } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages/stream`,
      payload: { content: 'go' },
    });
    const frames = parseEventStream(response.body).map((frame) => turnEventSchema.parse(frame.data));
    expect(frames.at(-1)?.type).toBe('turn.complete');
    expect(frames.some((frame) => frame.type === 'turn.error')).toBe(false);
    await gate.started;
    expect((await postRunOf(app, session.id)).postStatus).toBe('running');
    gate.release();
    await waitForPostRun(app, session.id, 'completed');
  });

  it('adds its writes to the turn’s entry, after the reply’s, and they are undone with the replies', async () => {
    const { app, session, gate } = await setup();
    await send(app, session.id);
    gate.release();
    const done = await waitForPostRun(app, session.id, 'completed');
    const [entry] = entriesOf(await readSession(app, session.id));
    expect(entry!.writes.map((write) => [write.nodeId, write.op])).toEqual([
      ['bump', 'set'],
      ['postBump', 'set'],
      ['postAdd', 'add'],
    ]);
    // The increment resolved against the state the reply left: 0 -> 1 -> 2; the item carries the post run's id.
    expect(entry!.writes.map((write) => ('value' in write ? write.value : undefined))).toEqual([1, 2, undefined]);
    expect(entry!.writes[2]).toMatchObject({ item: { id: `${done.postExecutionId}:postAdd:1`, text: 'n=0 turn=1' } });
    // The next turn starts from both.
    expect(await turn(app, session.id)).toEqual(['n=2 turn=2']);
    await waitForPostRun(app, session.id, 'completed');

    const { messages } = await readSession(app, session.id);
    for (const reply of messages.filter((message) => message.role === 'assistant'))
      await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}/messages/${reply.id}` });
    const view = await stateView(app, session.id);
    expect(view.turns.map((item) => [item.turnNumber, item.postStatus])).toEqual([
      [null, 'completed'],
      [null, 'completed'],
    ]);
    expect(view.definitions[0]!.values).toMatchObject({ n: 0, log: [] });
  });

  it('gives After Reply the turn’s replies and number, also when the turn has no reply', async () => {
    const { app, definition } = await bare();
    const wf = await makeWorkflow(
      app,
      [
        node('input', 'chat-input'),
        node('gate', 'condition', { left: '{{input.value}}', operator: 'isEmpty' }),
        node('output', 'chat-output'),
        node('after', 'after-reply'),
        node('setTurn', 'state-write', { definitionId: definition.id, key: 'n', op: 'set' }),
      ],
      [
        edge('input', 'message', 'gate', 'value'),
        edge('gate', 'true', 'output', 'value'),
        edge('after', 'turn', 'setTurn', 'value'),
      ],
      'Silent',
    );
    const session = await makeSession(app, wf.id);
    // The Chat Output sits behind a branch that is not taken: the turn counts but has no reply.
    expect((await send(app, session.id)).statusCode).toBe(200);
    const first = await waitForPostRun(app, session.id, 'completed');
    expect((await stateView(app, session.id)).turns[0]).toMatchObject({ replies: 0, turnNumber: 1 });
    expect((await readExecution(app, first.postExecutionId!)).nodes.after?.output).toEqual({
      replies: [],
      text: '',
      turn: 1,
    });
    expect((await send(app, session.id)).statusCode).toBe(200);
    await waitFor(async () => {
      const view = await stateView(app, session.id);
      return view.turns.length === 2 && view.turns.every((item) => item.postStatus === 'completed') ? view : undefined;
    });
    expect((await stateView(app, session.id)).definitions[0]!.values.n).toBe(2);
  });
});

describe('validation', () => {
  it('refuses a Chat Output that depends on After Reply, in plain words, and sends nothing', async () => {
    const { app } = await bare();
    const wf = await makeWorkflow(
      app,
      [node('input', 'chat-input'), node('output', 'chat-output'), node('after', 'after-reply')],
      [edge('after', 'text', 'output', 'value')],
      'Backwards',
    );
    const validation = await app.inject({ method: 'POST', url: `/api/workflows/${wf.id}/validate` });
    expect(validation.statusCode).toBe(422);
    const { error } = errorEnvelopeSchema.parse(validation.json());
    expect(error.code).toBe('WORKFLOW_INVALID');
    expect(error.details).toMatchObject({
      issues: [
        {
          nodeIds: ['output', 'after'],
          edgeId: 'after-text-output-value',
          message: expect.stringContaining("can't depend on"),
        },
      ],
    });
    const session = await makeSession(app, wf.id);
    const refused = await send(app, session.id);
    expect(refused.statusCode).toBe(400);
    expect(errorEnvelopeSchema.parse(refused.json()).error.code).toBe('WORKFLOW_INVALID');
    expect((await readSession(app, session.id)).messages).toEqual([]);
  });
});

describe('change events', () => {
  it('announces the settled turn once and the post run once more when it settles', async () => {
    const { app, session, gate } = await setup();
    const publish = vi.spyOn(ChangeHub.prototype, 'publish');
    const announced = () =>
      publish.mock.calls.filter(([event]) => event.type === 'sessions.changed' && event.id === session.id).length;
    await send(app, session.id);
    await gate.started;
    expect(announced()).toBe(1);
    gate.release();
    await waitForPostRun(app, session.id, 'completed');
    expect(announced()).toBe(2);
  });
});
