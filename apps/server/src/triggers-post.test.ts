import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiContract } from '@st/shared';
import { counterN, altRows, regenerate, swipe } from './test-support/alternatives.js';
import { afterReplyWorkflow, postHarness, stateView, waitForPostRun } from './test-support/post.js';
import { entriesOf, makeWorkflow, readExecution, readSession } from './test-support/story.js';
import { bumpingWorkflow, makeListSession, sayingWorkflow, sendTurn } from './test-support/triggers.js';

// The after-reply parts of a reply list's workflows run after all the reply parts, one per workflow, in list order.

const harness = postHarness('triggers-post');
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

/** Two workflows with an After Reply part, the first one's held at the gate; a chat listing both. */
async function twoWithAfterReply() {
  const context = await harness.bare();
  const gate = harness.gate();
  const { app, definition } = context;
  const one = await makeWorkflow(
    app,
    afterReplyWorkflow(definition.id, true).nodes,
    afterReplyWorkflow(definition.id, true).edges,
    'One',
  );
  const two = await makeWorkflow(
    app,
    afterReplyWorkflow(definition.id).nodes,
    afterReplyWorkflow(definition.id).edges,
    'Two',
  );
  const session = await makeListSession(app, [{ workflowId: one.id }, { workflowId: two.id }]);
  return { ...context, gate, one, two, session };
}

describe('two workflows that each have an After Reply part', () => {
  it('announces both runs when the replies settle, and runs them in list order on what the other wrote', async () => {
    const { app, gate, one, two, session } = await twoWithAfterReply();
    const result = await sendTurn(app, session.id);
    expect(result.assistantMessages.map((message) => message.content)).toEqual(['n=0 turn=1', 'n=1 turn=1']);
    await gate.started;
    // Both after-reply runs are listed while the first is held; the three post fields are derived from them.
    const entry = entriesOf(await readSession(app, session.id))[0]!;
    expect(entry).not.toHaveProperty('postStatus');
    expect(entry.runs!.map((run) => [run.workflowId, run.part, run.status])).toEqual([
      [one.id, 'reply', 'completed'],
      [two.id, 'reply', 'completed'],
      [one.id, 'post', 'running'],
      [two.id, 'post', 'running'],
    ]);
    const held = (await stateView(app, session.id)).turns[0]!;
    expect(held).toMatchObject({ postStatus: 'running', postExecutionId: entry.runs![2]!.executionId });
    expect(held.runs!.map((run) => run.status)).toEqual(['completed', 'completed', 'running', 'running']);

    gate.release();
    await waitForPostRun(app, session.id, 'completed');
    const done = (await stateView(app, session.id)).turns[0]!;
    expect(done.runs!.map((run) => run.status)).toEqual(Array(4).fill('completed'));
    // bump 1, bump 2 (it saw the first), then each post bump on what stood: 4 in all.
    expect(await counterN(app, session.id)).toBe(4);
    const log = (await stateView(app, session.id)).definitions[0]!.values.log as { text: string }[];
    expect(log.map((item) => item.text)).toEqual(['n=1 turn=1', 'n=0 turn=1']);
    // Each has its own log: its own workflow, the turn, a seed derived from its reply run's, and its own replies' text.
    const [replyOne, replyTwo] = result.executions!;
    const texts = ['n=0 turn=1', 'n=1 turn=1'];
    for (const [index, reply] of [replyOne!, replyTwo!].entries()) {
      const post = await readExecution(app, entry.runs![2 + index]!.executionId);
      expect(post).toMatchObject({
        part: 'post',
        status: 'completed',
        workflowId: reply.workflowId,
        turnExecutionId: result.execution.id,
        seed: `${reply.seed}:post`,
      });
      // After Reply outputs the replies of its own workflow's run only.
      expect(post.nodes.after?.output).toMatchObject({ text: texts[index] });
    }
  });

  it('stops the running after-reply run, skips the rest and records them as stopped, with no log', async () => {
    const { app, gate, session } = await twoWithAfterReply();
    await sendTurn(app, session.id);
    await gate.started;
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` })).statusCode).toBe(204);
    await waitForPostRun(app, session.id, 'stopped');
    const entry = entriesOf(await readSession(app, session.id))[0]!;
    expect(entry.runs!.map((run) => [run.part, run.status])).toEqual([
      ['reply', 'completed'],
      ['reply', 'completed'],
      ['post', 'stopped'],
      ['post', 'stopped'],
    ]);
    const first = await app.inject({ method: 'GET', url: `/api/executions/${entry.runs![2]!.executionId}` });
    expect(first.statusCode).toBe(200);
    // The one that never started has no log: that is how the chat knows it did not run.
    const skipped = await app.inject({ method: 'GET', url: `/api/executions/${entry.runs![3]!.executionId}` });
    expect(skipped.statusCode).toBe(404);
    // Stopping is not an error: the turn and the queue are fine.
    gate.release();
    expect((await sendTurn(app, session.id)).assistantMessages).toHaveLength(2);
  });

  it('records every after-reply run as interrupted when the server shuts down, the one that never started too', async () => {
    const { app, directory, gate, session } = await twoWithAfterReply();
    await sendTurn(app, session.id);
    await gate.started;
    await app.close();
    const stored = JSON.parse(await readFile(join(directory, 'sessions', `${session.id}.json`), 'utf8'));
    const post = stored.state.turns[0].runs.filter((run: { part: string }) => run.part === 'post');
    expect(post.map((run: { status: string; error: string }) => [run.status, run.error])).toEqual(
      Array(2).fill(['error', 'The run was interrupted by a server restart.']),
    );
  });
});

describe('regenerating a turn of two workflows', () => {
  async function chat() {
    const context = await harness.bare();
    const { app, definition } = context;
    const one = await bumpingWorkflow(app, definition.id, 'One', 'one n={{state.counter.n}} turn={{trigger.turn}}');
    const two = await sayingWorkflow(
      app,
      'Two',
      'two n={{state.counter.n}} turn={{trigger.turn}} hist={{history.length}}',
    );
    const session = await makeListSession(app, [{ workflowId: one.id }, { workflowId: two.id }]);
    return { ...context, one, two, session };
  }

  it('runs the whole list again as one new alternative, on the state without the turn it replaces', async () => {
    const { app, session, one, two } = await chat();
    const first = await sendTurn(app, session.id, 'hello');
    const result = apiContract.regenerate.response.parse((await regenerate(app, session.id)).json());
    // The same as the original turn saw: the state without it (n=0, then the first run's write), the same turn number.
    expect(result.assistantMessages.map((message) => message.content)).toEqual([
      'one n=0 turn=1',
      'two n=1 turn=1 hist=2',
    ]);
    expect(result.executions!.map((log) => log.workflowId)).toEqual([one.id, two.id]);
    const saved = await readSession(app, session.id);
    const root = first.execution.id;
    expect(altRows(saved)).toEqual([
      { content: 'one n=0 turn=1', executionId: root, alternativeOf: undefined, inactive: true },
      { content: 'two n=1 turn=1 hist=2', executionId: root, alternativeOf: undefined, inactive: true },
      { content: 'one n=0 turn=1', executionId: result.execution.id, alternativeOf: root, inactive: undefined },
      { content: 'two n=1 turn=1 hist=2', executionId: result.execution.id, alternativeOf: root, inactive: undefined },
    ]);
    const [, entry] = entriesOf(saved);
    expect(entry).toMatchObject({ executionId: result.execution.id, completed: true, replies: 2 });
    expect(entry!.runs!.map((run) => run.workflowId)).toEqual([one.id, two.id]);
    const view = await stateView(app, session.id);
    expect(view.turns.map((turn) => turn.turnNumber)).toEqual([null, 1]);
    expect(await counterN(app, session.id)).toBe(1);
  });

  it('swipes every run of the turn at once', async () => {
    const { app, session } = await chat();
    const first = await sendTurn(app, session.id, 'hello');
    await regenerate(app, session.id);
    expect((await swipe(app, session.id, first.execution.id)).statusCode).toBe(200);
    const saved = await readSession(app, session.id);
    expect(altRows(saved).map((row) => row.inactive)).toEqual([undefined, undefined, true, true]);
    expect((await stateView(app, session.id)).turns.map((turn) => turn.turnNumber)).toEqual([1, null]);
  });
});
