import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiContract } from '@st/shared';
import { counterN, altRows, regenerate, swipe } from './test-support/alternatives.js';
import { postHarness, replyWorkflow, stateView, trailingWorkflow, waitForPostRun } from './test-support/post.js';
import { entriesOf, makeWorkflow, readExecution, readSession } from './test-support/story.js';
import { bumpingWorkflow, makeListSession, sayingWorkflow, sendTurn } from './test-support/triggers.js';

// The workflows of a reply list below the last one that replies run after the reply, one after another, in list order.

const harness = postHarness('triggers-after');
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

/** A replying workflow and two trailing ones, the first of those held at the gate; a chat listing the three. */
async function twoAfterTheReply() {
  const context = await harness.bare();
  const gate = harness.gate();
  const { app, definition } = context;
  const reply = replyWorkflow(definition.id);
  const first = await makeWorkflow(app, reply.nodes, reply.edges, 'Reply');
  const held = trailingWorkflow(definition.id, true);
  const one = await makeWorkflow(app, held.nodes, held.edges, 'One');
  const plain = trailingWorkflow(definition.id);
  const two = await makeWorkflow(app, plain.nodes, plain.edges, 'Two');
  const session = await makeListSession(app, [
    { workflowId: first.id },
    { workflowId: one.id },
    { workflowId: two.id },
  ]);
  return { ...context, gate, first, one, two, session };
}

describe('two workflows below the one that replies', () => {
  it('announces both runs when the reply section settles, and runs them in list order on what the other wrote', async () => {
    const { app, gate, first, one, two, session } = await twoAfterTheReply();
    const result = await sendTurn(app, session.id);
    expect(result.assistantMessages.map((message) => message.content)).toEqual(['n=0 turn=1']);
    await gate.started;
    // Both runs are listed while the first is held; the derived fields of the view come from them.
    const entry = entriesOf(await readSession(app, session.id))[0]!;
    expect(entry).not.toHaveProperty('postStatus');
    expect(entry.runs!.map((run) => [run.workflowId, run.part, run.status])).toEqual([
      [first.id, 'reply', 'completed'],
      [one.id, 'post', 'running'],
      [two.id, 'post', 'running'],
    ]);
    const held = (await stateView(app, session.id)).turns[0]!;
    expect(held).toMatchObject({ postStatus: 'running', postExecutionId: entry.runs![1]!.executionId });
    expect(held.runs!.map((run) => run.status)).toEqual(['completed', 'running', 'running']);

    gate.release();
    await waitForPostRun(app, session.id, 'completed');
    const done = (await stateView(app, session.id)).turns[0]!;
    expect(done.runs!.map((run) => run.status)).toEqual(Array(3).fill('completed'));
    // bump 1, then each run after the reply on what stood: 3 in all.
    expect(await counterN(app, session.id)).toBe(3);
    const log = (await stateView(app, session.id)).definitions[0]!.values.log as { text: string }[];
    expect(log.map((item) => item.text)).toEqual(['n=0 turn=1', 'n=0 turn=1']);
    // Each has its own log: its own workflow, the turn, its own seed.
    const seeds = new Set<string | undefined>([result.execution!.seed]);
    for (const [index, workflowId] of [one.id, two.id].entries()) {
      const post = await readExecution(app, entry.runs![1 + index]!.executionId);
      expect(post).toMatchObject({
        part: 'post',
        status: 'completed',
        workflowId,
        turnExecutionId: result.execution!.id,
      });
      seeds.add(post.seed);
    }
    expect(seeds.size).toBe(3);
  });

  it('stops the running run, skips the rest and records them as stopped, with no log', async () => {
    const { app, gate, session } = await twoAfterTheReply();
    await sendTurn(app, session.id);
    await gate.started;
    expect((await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` })).statusCode).toBe(204);
    await waitForPostRun(app, session.id, 'stopped');
    const entry = entriesOf(await readSession(app, session.id))[0]!;
    expect(entry.runs!.map((run) => [run.part, run.status])).toEqual([
      ['reply', 'completed'],
      ['post', 'stopped'],
      ['post', 'stopped'],
    ]);
    const first = await app.inject({ method: 'GET', url: `/api/executions/${entry.runs![1]!.executionId}` });
    expect(first.statusCode).toBe(200);
    // The one that never started has no log: that is how the chat knows it did not run.
    const skipped = await app.inject({ method: 'GET', url: `/api/executions/${entry.runs![2]!.executionId}` });
    expect(skipped.statusCode).toBe(404);
    // Stopping is not an error: the turn and the queue are fine.
    gate.release();
    expect((await sendTurn(app, session.id)).assistantMessages).toHaveLength(1);
  });

  it('records every run after the reply as interrupted when the server shuts down, the one that never started too', async () => {
    const { app, directory, gate, session } = await twoAfterTheReply();
    await sendTurn(app, session.id);
    await gate.started;
    await app.close();
    const stored = JSON.parse(await readFile(join(directory, 'sessions', `${session.id}.json`), 'utf8'));
    const post = stored.state.turns[0].runs.filter((run: { part: string }) => run.part === 'post');
    expect(post.map((run: { status: string; error: string }) => [run.status, run.error])).toEqual(
      Array(2).fill(['error', 'The run was interrupted by a server restart.']),
    );
  });

  it('keeps going when one of them fails: its failure is its own, and the next one still runs', async () => {
    const { app, gate, session } = await twoAfterTheReply();
    await sendTurn(app, session.id);
    await gate.started;
    gate.fail('boom');
    await waitForPostRun(app, session.id, 'error');
    const view = (await stateView(app, session.id)).turns[0]!;
    expect(view.runs!.map((run) => run.status)).toEqual(['completed', 'error', 'completed']);
    expect(view).toMatchObject({ postStatus: 'error', postError: 'Post Gate (gate): boom', completed: true });
    expect(await counterN(app, session.id)).toBe(3);
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
    const root = first.execution!.id;
    expect(altRows(saved)).toEqual([
      { content: 'one n=0 turn=1', executionId: root, alternativeOf: undefined, inactive: true },
      { content: 'two n=1 turn=1 hist=2', executionId: root, alternativeOf: undefined, inactive: true },
      { content: 'one n=0 turn=1', executionId: result.execution!.id, alternativeOf: root, inactive: undefined },
      { content: 'two n=1 turn=1 hist=2', executionId: result.execution!.id, alternativeOf: root, inactive: undefined },
    ]);
    const [, entry] = entriesOf(saved);
    expect(entry).toMatchObject({ executionId: result.execution!.id, completed: true, replies: 2 });
    expect(entry!.runs!.map((run) => run.workflowId)).toEqual([one.id, two.id]);
    const view = await stateView(app, session.id);
    expect(view.turns.map((turn) => turn.turnNumber)).toEqual([null, 1]);
    expect(await counterN(app, session.id)).toBe(1);
  });

  it('swipes every run of the turn at once', async () => {
    const { app, session } = await chat();
    const first = await sendTurn(app, session.id, 'hello');
    await regenerate(app, session.id);
    expect((await swipe(app, session.id, first.execution!.id)).statusCode).toBe(200);
    const saved = await readSession(app, session.id);
    expect(altRows(saved).map((row) => row.inactive)).toEqual([undefined, undefined, true, true]);
    expect((await stateView(app, session.id)).turns.map((turn) => turn.turnNumber)).toEqual([1, null]);
  });
});
