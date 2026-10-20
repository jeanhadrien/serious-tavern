import { afterEach, expect, it, vi } from 'vitest';
import { apiContract } from '@st/shared';
import { postHarness, stateView, waitForPostRun, watchQueue } from './test-support/post.js';
import { entriesOf, readExecution, readSession, send } from './test-support/story.js';
import { counterN, regenerate } from './test-support/alternatives.js';

// A regenerated turn is an ordinary turn: its own runs after the reply, in the chat's queue slot.

const harness = postHarness('regenerate-after');
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

it('waits for the run after the reply of the turn, then runs its own for the new alternative', async () => {
  const { app, session, gate } = await harness.setup();
  const queue = watchQueue();
  await send(app, session.id, 'hello');
  await gate.started;
  const running = regenerate(app, session.id);
  await queue.reached(1);
  await new Promise((resolve) => setTimeout(resolve, 100));
  // The regenerate waits behind the held run after the reply: nothing of it is stored yet.
  expect((await readSession(app, session.id)).messages.map((message) => message.inactive)).toEqual([
    undefined,
    undefined,
  ]);
  gate.release();
  const result = apiContract.regenerate.response.parse((await running).json());
  // The alternative runs on the state without the turn it replaces: n=0, turn=1 again.
  expect(result.assistantMessages.map((message) => message.content)).toEqual(['n=0 turn=1']);
  const post = await waitForPostRun(app, session.id, 'completed');

  const saved = await readSession(app, session.id);
  const [first, second] = entriesOf(saved);
  expect(second!.executionId).toBe(result.execution!.id);
  expect(second!.runs!.find((run) => run.part === 'post')?.executionId).toBe(post.postExecutionId);
  expect((await readExecution(app, post.postExecutionId!)).turnExecutionId).toBe(result.execution!.id);
  // The replaced turn keeps its own record, but it is not present: only the shown alternative's reply and
  // after-section writes count (n: +1 and +1), and the collection holds one item.
  const view = await stateView(app, session.id);
  expect(view.turns.map((turn) => [turn.executionId === first!.executionId, turn.turnNumber, turn.postStatus])).toEqual(
    [
      [true, null, 'completed'],
      [false, 1, 'completed'],
    ],
  );
  expect(await counterN(app, session.id)).toBe(2);
  expect(view.definitions[0]!.values.log).toHaveLength(1);
});
