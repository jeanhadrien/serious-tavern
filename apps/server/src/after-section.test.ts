import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiContract, errorEnvelopeSchema, turnEventSchema } from '@st/shared';
import { ChangeHub } from './services/change-events.js';
import { parseEventStream } from './test-support/event-stream.js';
import {
  postHarness,
  postRunOf,
  replyWorkflow,
  stateView,
  trailingWorkflow,
  waitForPostRun,
} from './test-support/post.js';
import { edge, entriesOf, makeWorkflow, node, readExecution, readSession, send, turn } from './test-support/story.js';
import { regenerate } from './test-support/alternatives.js';
import { makeListSession, sendTurn } from './test-support/triggers.js';

// The workflows of a chat's list below the last one that replies run after the reply, as the turn's own runs.

const harness = postHarness('after-section');
const { bare, setup } = harness;
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

const sendResult = (response: { json(): unknown }) => apiContract.sendMessage.response.parse(response.json());

describe('a chat whose workflows all reply', () => {
  it('has no run after the reply and leaves the entry with its reply run only', async () => {
    const { app, directory, definition } = await bare();
    const { nodes, edges } = replyWorkflow(definition.id);
    const workflow = await makeWorkflow(app, nodes, edges);
    const session = await makeListSession(app, [{ workflowId: workflow.id }]);
    expect(await turn(app, session.id)).toEqual(['n=0 turn=1']);
    const raw = (await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` })).json();
    for (const field of ['postExecutionId', 'postStatus', 'postError'])
      expect(raw.state.turns[0]).not.toHaveProperty(field);
    expect(raw.state.turns[0].runs).toMatchObject([{ part: 'reply', status: 'completed' }]);
    expect(await postRunOf(app, session.id)).toEqual({});
    expect(await readdir(join(directory, 'executions'))).toHaveLength(1);
  });
});

describe('the run after the reply', () => {
  it('starts after the reply is delivered, with its own log linked to the turn', async () => {
    const { app, session, gate, workflow, after } = await setup();
    const response = await send(app, session.id);
    expect(response.statusCode).toBe(200);
    const result = sendResult(response);
    await gate.started;
    // The reply is complete while the run after it is held; the entry says so, and so does the state view.
    expect(result.assistantMessages.map((message) => message.content)).toEqual(['n=0 turn=1']);
    expect(result.executions!.map((log) => log.workflowId)).toEqual([workflow.id]);
    const [entry] = entriesOf(await readSession(app, session.id));
    // The entry lists its two runs: the reply run, and the run after the reply announced as running.
    expect(entry).toMatchObject({ completed: true, replies: 1 });
    expect(entry).not.toHaveProperty('postStatus');
    expect(entry!.runs).toMatchObject([
      { executionId: result.execution!.id, workflowId: workflow.id, part: 'reply', status: 'completed' },
      { workflowId: after.id, part: 'post', status: 'running' },
    ]);
    const postId = entry!.runs![1]!.executionId;
    expect(await postRunOf(app, session.id)).toEqual({ postStatus: 'running', postExecutionId: postId });
    // The reply section's log lists only the reply workflow's nodes.
    expect(Object.keys(result.execution!.nodes).sort()).toEqual(['bump', 'input', 'output']);

    gate.release();
    const done = await waitForPostRun(app, session.id, 'completed');
    expect(done.postExecutionId).toBe(postId);
    const post = await readExecution(app, postId);
    expect(post).toMatchObject({
      part: 'post',
      status: 'completed',
      workflowId: after.id,
      turnExecutionId: result.execution!.id,
      settings: result.execution!.settings,
    });
    // Its own seed: not derived from the reply run's.
    expect(post.seed).toBeTruthy();
    expect(post.seed).not.toBe(result.execution!.seed);
    expect(Object.keys(post.nodes).sort()).toEqual(['gate', 'input', 'postAdd', 'postBump', 'text']);
    // The reply and its log are untouched.
    expect((await readSession(app, session.id)).messages.map((message) => message.content)).toEqual([
      'go',
      'n=0 turn=1',
    ]);
    expect((await readExecution(app, result.execution!.id)).part).toBeUndefined();
  });

  it('does not hold the stream open: it ends with turn.complete while the run after the reply works', async () => {
    const { app, session, gate } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages/stream`,
      payload: { content: 'go' },
    });
    const frames = parseEventStream(response.body).map((frame) => turnEventSchema.parse(frame.data));
    expect(frames.at(-1)?.type).toBe('turn.complete');
    expect(frames.some((frame) => frame.type === 'turn.error')).toBe(false);
    // Only the reply section streams: the workflow after it announces no run.
    expect(frames.filter((frame) => frame.type === 'run.start')).toHaveLength(1);
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
    // The increment resolved against what the reply run committed: 0 -> 1 -> 2; the item carries the run's id.
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

  it('sees the chat as it stands: the user message, then the reply, in its history and in Chat Input’s replies', async () => {
    const { app, definition } = await bare();
    const reply = replyWorkflow(definition.id);
    const first = await makeWorkflow(app, reply.nodes, reply.edges, 'Reply');
    // Chat Input's history instead of its replies: the whole chat as it stands.
    const trailing = trailingWorkflow(definition.id);
    const second = await makeWorkflow(
      app,
      trailing.nodes,
      [
        edge('input', 'history', 'text', 'value'),
        edge('input', 'turn', 'postBump', 'when'),
        edge('text', 'value', 'postAdd', 'value'),
      ],
      'Reads history',
    );
    const third = await makeWorkflow(app, trailing.nodes, trailing.edges, 'Reads replies');
    const session = await makeListSession(
      app,
      [first, second, third].map(({ id }) => ({ workflowId: id })),
    );
    await sendTurn(app, session.id, 'hello');
    await waitForPostRun(app, session.id, 'completed');
    const view = await stateView(app, session.id);
    expect((view.definitions[0]!.values.log as { text: string }[]).map((item) => item.text)).toEqual([
      'n=0 turn=1',
      'hello\n\nn=0 turn=1',
    ]);
    // Each run read what the ones above it did: reply +1, then the two after-section increments.
    expect(view.definitions[0]!.values.n).toBe(3);
  });
});

describe('a chat with no workflow that can reply', () => {
  it('completes the turn at once with no reply and runs every workflow after the result', async () => {
    const { app, session, gate, after } = await setup();
    // Switch the replying workflow off: only the trailing workflow is left, and it has no Chat Output.
    const listed = (await readSession(app, session.id)).triggers!.reply;
    await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      payload: { triggers: { reply: listed.map((entry) => ({ ...entry, enabled: entry.workflowId === after.id })) } },
    });
    const response = await send(app, session.id, 'hello');
    expect(response.statusCode).toBe(200);
    const result = sendResult(response);
    expect(result.assistantMessages).toEqual([]);
    expect(result.execution).toBeUndefined();
    expect(result.userMessage?.content).toBe('hello');
    await gate.started;
    const [entry] = entriesOf(await readSession(app, session.id));
    expect(entry).toMatchObject({ completed: true, replies: 0 });
    expect(entry!.runs).toMatchObject([{ workflowId: after.id, part: 'post', status: 'running' }]);
    expect(
      (await readSession(app, session.id)).messages.every((message) => message.executionId === entry!.executionId),
    ).toBe(true);
    gate.release();
    await waitForPostRun(app, session.id, 'completed');
    const view = await stateView(app, session.id);
    // A turn without replies counts when it completed: its writes apply, and it is turn 1.
    expect(view.turns[0]).toMatchObject({ replies: 0, turnNumber: 1 });
    expect(view.definitions[0]!.values).toMatchObject({ n: 1 });
  });

  it('streams only turn.start and turn.complete, with no run.start', async () => {
    const { app, definition } = await bare();
    const trailing = trailingWorkflow(definition.id);
    const only = await makeWorkflow(app, trailing.nodes, trailing.edges, 'Silent');
    const session = await makeListSession(app, [{ workflowId: only.id }]);
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages/stream`,
      payload: { content: 'hello' },
    });
    const frames = parseEventStream(response.body).map((frame) => turnEventSchema.parse(frame.data));
    expect(frames.map((frame) => frame.type)).toEqual(['turn.start', 'turn.complete']);
    const done = frames.at(-1);
    expect(done).toMatchObject({ type: 'turn.complete', assistantMessages: [], executions: [] });
    expect(done).not.toHaveProperty('execution');
    await waitForPostRun(app, session.id, 'completed');
  });

  it('runs no workflow when a regenerate has no reply to give, and leaves the shown reply alone', async () => {
    const { app, session, after, gate } = await setup();
    await sendTurn(app, session.id);
    gate.release();
    await waitForPostRun(app, session.id, 'completed');
    const listed = (await readSession(app, session.id)).triggers!.reply;
    await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      payload: { triggers: { reply: listed.map((entry) => ({ ...entry, enabled: entry.workflowId === after.id })) } },
    });
    const before = await readSession(app, session.id);
    expect((await regenerate(app, session.id)).statusCode).toBe(200);
    const saved = await readSession(app, session.id);
    expect(saved.messages).toEqual(before.messages);
    const [, entry] = entriesOf(saved);
    expect(entry).toMatchObject({ completed: false, replies: 0 });
    expect(entry!.runs ?? []).toEqual([]);
    expect((await stateView(app, session.id)).turns.map((item) => item.turnNumber)).toEqual([1, null]);
  });

  it('gives Chat Input’s replies as empty and its turn as the turn’s number', async () => {
    const { app, definition } = await bare();
    const wf = await makeWorkflow(
      app,
      [
        node('input', 'chat-input'),
        node('setTurn', 'state-write', { definitionId: definition.id, key: 'n', op: 'set' }),
      ],
      [edge('input', 'turn', 'setTurn', 'value')],
      'Silent',
    );
    const session = await makeListSession(app, [{ workflowId: wf.id }]);
    expect((await send(app, session.id)).statusCode).toBe(200);
    const first = await waitForPostRun(app, session.id, 'completed');
    expect((await readExecution(app, first.postExecutionId!)).nodes.input?.output).toMatchObject({
      replies: [],
      turn: 1,
    });
    expect((await send(app, session.id)).statusCode).toBe(200);
    await waitForPostRun(app, session.id, 'completed');
    const view = await stateView(app, session.id);
    expect(view.turns.map((item) => item.turnNumber)).toEqual([1, 2]);
    expect(view.definitions[0]!.values.n).toBe(2);
  });
});

describe('a workflow with no Chat Output above the one that replies', () => {
  it('runs in the reply section, before the reply, and its writes are seen by the reply', async () => {
    const { app, definition } = await bare();
    const trailing = trailingWorkflow(definition.id);
    const silent = await makeWorkflow(app, trailing.nodes, trailing.edges, 'Silent');
    const reply = replyWorkflow(definition.id);
    const replying = await makeWorkflow(app, reply.nodes, reply.edges, 'Reply');
    const session = await makeListSession(app, [{ workflowId: silent.id }, { workflowId: replying.id }]);
    const result = await sendTurn(app, session.id);
    // Both ran while the turn was answered: the reply read what the silent workflow wrote (n: 0 -> 1).
    expect(result.executions!.map((log) => log.workflowId)).toEqual([silent.id, replying.id]);
    expect(result.assistantMessages.map((message) => message.content)).toEqual(['n=1 turn=1']);
    const [entry] = entriesOf(await readSession(app, session.id));
    expect(entry!.runs!.map((run) => [run.workflowId, run.part])).toEqual([
      [silent.id, 'reply'],
      [replying.id, 'reply'],
    ]);
    expect(await postRunOf(app, session.id)).toEqual({});
  });
});

describe('validation', () => {
  it('accepts a workflow whose only sink is a State Write, and refuses one with no sink, in plain words', async () => {
    const { app, definition } = await bare();
    const writer = await makeWorkflow(
      app,
      [node('input', 'chat-input'), node('set', 'state-write', { definitionId: definition.id, key: 'n', op: 'set' })],
      [edge('input', 'turn', 'set', 'value')],
      'Writes only',
    );
    expect((await app.inject({ method: 'POST', url: `/api/workflows/${writer.id}/validate` })).statusCode).toBe(200);
    const bare_ = await makeWorkflow(app, [node('input', 'chat-input')], [], 'Does nothing');
    const validation = await app.inject({ method: 'POST', url: `/api/workflows/${bare_.id}/validate` });
    expect(validation.statusCode).toBe(422);
    const { error } = errorEnvelopeSchema.parse(validation.json());
    expect(error.code).toBe('WORKFLOW_INVALID');
    expect(error.details).toMatchObject({
      issues: [{ message: expect.stringContaining('at least one node that writes something') }],
    });
    const session = await makeListSession(app, [{ workflowId: bare_.id }]);
    const refused = await send(app, session.id);
    expect(refused.statusCode).toBe(400);
    expect(errorEnvelopeSchema.parse(refused.json()).error.code).toBe('WORKFLOW_INVALID');
    expect((await readSession(app, session.id)).messages).toEqual([]);
  });
});

describe('change events', () => {
  it('announces the settled reply section once and each run after it once more when it settles', async () => {
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
