import { afterEach, describe, expect, it } from 'vitest';
import { apiContract } from '@st/shared';
import { stateView } from './test-support/post.js';
import { holdingReply, holdingWriter, holdNodes } from './test-support/concurrency.js';
import {
  assistantRows,
  define,
  entriesOf,
  readExecution,
  readSession,
  send,
  tempApps,
  type App,
} from './test-support/story.js';
import { makeListSession, sayingWorkflow } from './test-support/triggers.js';

// Workflows of a reply list that cannot affect each other run at the same time, and the result is always what running
// them top to bottom would give. Every order here is the test's: a node holds each run until the test lets it go.

const apps = tempApps('triggers-concurrency');
let hold: ReturnType<typeof holdNodes> | undefined;
afterEach(async () => {
  hold?.dispose();
  hold = undefined;
  await apps.cleanup();
});

async function open() {
  hold = holdNodes();
  const { app } = await apps.open();
  return { app, hold, definition: await define(app) };
}

const stop = (app: App, sessionId: string) => app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/stop` });
const planOf = async (app: App, sessionId: string) =>
  apiContract.getReplyPlan.response.parse(
    (await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/reply-plan` })).json(),
  ).entries;
const sendOk = async (running: ReturnType<typeof send>) => {
  const response = await running;
  if (response.statusCode !== 200) throw new Error(`turn failed: ${response.statusCode} ${response.body}`);
  return apiContract.sendMessage.response.parse(response.json());
};

describe('independent workflows', () => {
  it('run at the same time, and their replies are stored in list order when the lower one finishes first', async () => {
    const { app, hold, definition: _ } = await open();
    try {
      const upper = await holdingReply(app, 'Upper', 'a', 'upper');
      const lower = await holdingReply(app, 'Lower', 'b', 'lower');
      const session = await makeListSession(app, [{ workflowId: upper.id }, { workflowId: lower.id }]);
      expect((await planOf(app, session.id)).map((entry) => entry.waitsFor)).toEqual([[], []]);
      const running = send(app, session.id);
      // Both began holding before either ended: they run together.
      await hold.started(2);
      expect(hold.begun.sort()).toEqual(['a', 'b']);
      // The lower workflow finishes and settles first.
      hold.release('b');
      await expect.poll(async () => assistantRows(await readSession(app, session.id)).length).toBe(1);
      expect(assistantRows(await readSession(app, session.id))[0]!.content).toBe('lower');
      hold.release('a');
      const result = await sendOk(running);
      // The turn's answer and the stored chat read as if the runs had finished top to bottom.
      expect(result.assistantMessages.map((message) => message.content)).toEqual(['upper', 'lower']);
      const saved = await readSession(app, session.id);
      expect(saved.messages.map((message) => message.content)).toEqual(['go', 'upper', 'lower']);
      const [entry, ...others] = entriesOf(saved);
      expect(others).toEqual([]);
      expect(entry).toMatchObject({ completed: true, replies: 2 });
      expect(entry!.runs!.map((run) => [run.workflowId, run.position, run.status])).toEqual([
        [upper.id, 0, 'completed'],
        [lower.id, 1, 'completed'],
      ]);
      expect(result.executions!.map((log) => log.workflowId)).toEqual([upper.id, lower.id]);
      // Neither waited for anything, and says so.
      for (const log of result.executions!) expect(log.waitedFor).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('stores two sets of one key in list order: the lower one wins even when it settles first', async () => {
    const { app, hold, definition } = await open();
    try {
      const upper = await holdingWriter(
        app,
        'Upper',
        'a',
        { definitionId: definition.id, key: 'n', op: 'set', value: 1 },
        'upper',
      );
      const lower = await holdingWriter(
        app,
        'Lower',
        'b',
        { definitionId: definition.id, key: 'n', op: 'set', value: 2 },
        'lower',
      );
      const session = await makeListSession(app, [{ workflowId: upper.id }, { workflowId: lower.id }]);
      // Both only write the key, so neither waits for the other.
      expect((await planOf(app, session.id)).map((entry) => entry.waitsFor)).toEqual([[], []]);
      const running = send(app, session.id);
      await hold.started(2);
      hold.release('b');
      // The lower run's write is committed before the upper run has finished.
      await expect
        .poll(async () => entriesOf(await readSession(app, session.id))[0]?.writes.map((write) => write.value))
        .toEqual([2]);
      hold.release('a');
      await sendOk(running);
      const [entry] = entriesOf(await readSession(app, session.id));
      // Stored by position, each tagged with its run: the upper one's write first.
      expect(entry!.writes.map((write) => [write.runId, (write as { value?: unknown }).value])).toEqual([
        [entry!.runs![0]!.executionId, 1],
        [entry!.runs![1]!.executionId, 2],
      ]);
      expect((await stateView(app, session.id)).definitions[0]!.values.n).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('keep what a run lower in the list committed away from the runs above it', async () => {
    const { app, hold, definition } = await open();
    try {
      const upper = await holdingReply(app, 'Upper', 'a', 'n={{state.counter.n}}');
      const lower = await holdingWriter(
        app,
        'Lower',
        'b',
        { definitionId: definition.id, key: 'n', op: 'set', value: 4 },
        'lower',
      );
      const session = await makeListSession(app, [{ workflowId: upper.id }, { workflowId: lower.id }]);
      const running = send(app, session.id);
      await hold.started(2);
      hold.release('b');
      await expect.poll(async () => entriesOf(await readSession(app, session.id))[0]?.writes.length).toBe(1);
      hold.release('a');
      // The lower run committed first, but the upper one never sees what a run listed below it wrote.
      expect((await sendOk(running)).assistantMessages.map((message) => message.content)).toEqual(['n=0', 'lower']);
      expect((await stateView(app, session.id)).definitions[0]!.values.n).toBe(4);
    } finally {
      await app.close();
    }
  });
});

describe('workflows that depend on one another', () => {
  it('wait: a workflow reading a key another writes starts once the writer has settled, and sees the write', async () => {
    const { app, hold, definition } = await open();
    try {
      const writer = await holdingWriter(
        app,
        'Writer',
        'a',
        { definitionId: definition.id, key: 'n', op: 'set', value: 3 },
        'wrote',
      );
      const reader = await holdingReply(app, 'Reader', 'b', 'n={{state.counter.n}}');
      const session = await makeListSession(app, [{ workflowId: writer.id }, { workflowId: reader.id }]);
      const [, plan] = await planOf(app, session.id);
      expect(plan).toMatchObject({ waitsFor: [writer.id], reason: 'reads counter.n, which Writer writes' });
      const running = send(app, session.id);
      await hold.started(1);
      expect(hold.begun).toEqual(['a']);
      hold.release('a');
      await hold.started(2);
      hold.release('b');
      const result = await sendOk(running);
      expect(result.assistantMessages.map((message) => message.content)).toEqual(['wrote', 'n=3']);
      const [writerRun, readerRun] = entriesOf(await readSession(app, session.id))[0]!.runs!;
      const writerLog = await readExecution(app, writerRun!.executionId);
      const readerLog = await readExecution(app, readerRun!.executionId);
      expect(readerLog.waitedFor).toEqual([writerLog.id]);
      expect(writerLog.waitedFor).toEqual([]);
      // It began after the writer's run had ended.
      expect(readerLog.nodes.hold!.startedAt! >= writerLog.finishedAt!).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('wait for each other when both increment one key, and count twice', async () => {
    const { app, hold, definition } = await open();
    try {
      const write = { definitionId: definition.id, key: 'n', op: 'increment' };
      const upper = await holdingWriter(app, 'Upper', 'a', write, 'upper');
      const lower = await holdingWriter(app, 'Lower', 'b', write, 'lower');
      const session = await makeListSession(app, [{ workflowId: upper.id }, { workflowId: lower.id }]);
      expect((await planOf(app, session.id)).map((entry) => entry.waitsFor)).toEqual([[], [upper.id]]);
      const running = send(app, session.id);
      await hold.started(1);
      hold.release('a');
      await hold.started(2);
      hold.release('b');
      await sendOk(running);
      const [entry] = entriesOf(await readSession(app, session.id));
      expect(entry!.writes.map((write) => (write as { value?: unknown }).value)).toEqual([1, 2]);
      expect((await stateView(app, session.id)).definitions[0]!.values.n).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('wait for every workflow above that replies when they read the chat history', async () => {
    const { app, hold } = await open();
    try {
      const first = await holdingReply(app, 'First', 'a', 'first');
      const second = await holdingReply(app, 'Second', 'b', 'second');
      const reader = await sayingWorkflow(app, 'Reader', 'saw {{history.length}}');
      const session = await makeListSession(app, [
        { workflowId: first.id },
        { workflowId: second.id },
        { workflowId: reader.id },
      ]);
      const plan = await planOf(app, session.id);
      expect(plan.map((entry) => entry.waitsFor)).toEqual([[], [], [first.id, second.id]]);
      expect(plan[2]!.reason).toBe('reads the chat history First writes; reads the chat history Second writes');
      const running = send(app, session.id);
      await hold.started(2);
      hold.release('b');
      hold.release('a');
      // The reader saw the user message and both replies, in list order.
      expect((await sendOk(running)).assistantMessages.map((message) => message.content)).toEqual([
        'first',
        'second',
        'saw 3',
      ]);
    } finally {
      await app.close();
    }
  });
});

describe('stopping and failing', () => {
  it('stops every running run, and records each as stopped', async () => {
    const { app, hold } = await open();
    try {
      const upper = await holdingReply(app, 'Upper', 'a', 'upper');
      const lower = await holdingReply(app, 'Lower', 'b', 'lower');
      const session = await makeListSession(app, [{ workflowId: upper.id }, { workflowId: lower.id }]);
      const running = send(app, session.id);
      await hold.started(2);
      expect((await stop(app, session.id)).statusCode).toBe(204);
      const response = await running;
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('TURN_STOPPED');
      expect(response.json().error.details.executions).toHaveLength(2);
      const saved = await readSession(app, session.id);
      expect(entriesOf(saved)[0]!.runs!.map((run) => [run.workflowId, run.status])).toEqual([
        [upper.id, 'stopped'],
        [lower.id, 'stopped'],
      ]);
      expect(entriesOf(saved)[0]).toMatchObject({ completed: false });
    } finally {
      await app.close();
    }
  });

  it('lets the others go on when one fails, and reports the failure by name', async () => {
    const { app, hold } = await open();
    try {
      const failing = await holdingReply(app, 'Failing', 'a', 'never');
      const fine = await holdingReply(app, 'Fine', 'b', 'still here');
      const session = await makeListSession(app, [{ workflowId: failing.id }, { workflowId: fine.id }]);
      const running = send(app, session.id);
      await hold.started(2);
      hold.fail('a', 'boom');
      // The other run is still going: it is not stopped by the failure.
      hold.release('b');
      const response = await running;
      expect(response.statusCode).toBe(500);
      expect(response.json().error.message).toMatch(/^Workflow "Failing" failed: .*boom/);
      expect(
        response.json().error.details.assistantMessages.map((message: { content: string }) => message.content),
      ).toEqual(['still here']);
      expect(
        entriesOf(await readSession(app, session.id))[0]!.runs!.map((run) => [run.workflowId, run.status]),
      ).toEqual([
        [failing.id, 'error'],
        [fine.id, 'completed'],
      ]);
    } finally {
      await app.close();
    }
  });

  it('starts a run whose predecessor failed, on what was committed', async () => {
    const { app, hold, definition } = await open();
    try {
      const failing = await holdingWriter(
        app,
        'Failing',
        'a',
        { definitionId: definition.id, key: 'n', op: 'set', value: 2 },
        'x',
      );
      const reader = await sayingWorkflow(app, 'Reader', 'n={{state.counter.n}}');
      const session = await makeListSession(app, [{ workflowId: failing.id }, { workflowId: reader.id }]);
      expect((await planOf(app, session.id))[1]!.waitsFor).toEqual([failing.id]);
      const running = send(app, session.id);
      await hold.started(1);
      hold.fail('a', 'boom');
      const response = await running;
      expect(response.statusCode).toBe(500);
      // The reader ran after the failed run ended, and saw nothing of its (never made) write.
      expect(
        response.json().error.details.assistantMessages.map((message: { content: string }) => message.content),
      ).toEqual(['x', 'n=0']);
    } finally {
      await app.close();
    }
  });
});

describe('the after section', () => {
  it('runs independent workflows below the last reply at the same time, once the reply was sent', async () => {
    const { app, hold, definition } = await open();
    try {
      const reply = await sayingWorkflow(app, 'Reply', 'hello');
      const first = await holdingWriter(app, 'First', 'a', {
        definitionId: definition.id,
        key: 'n',
        op: 'set',
        value: 1,
      });
      const second = await holdingWriter(app, 'Second', 'b', {
        definitionId: definition.id,
        key: 'mood',
        op: 'set',
        value: 'tense',
      });
      const session = await makeListSession(app, [
        { workflowId: reply.id },
        { workflowId: first.id },
        { workflowId: second.id },
      ]);
      // The reply is complete while both are still held, and both began before either ended.
      const result = await sendOk(send(app, session.id));
      expect(result.assistantMessages.map((message) => message.content)).toEqual(['hello']);
      await hold.started(2);
      hold.release('b');
      hold.release('a');
      await expect.poll(async () => (await stateView(app, session.id)).turns[0]!.postStatus).toBe('completed');
      const view = await stateView(app, session.id);
      expect(view.definitions[0]!.values.n).toBe(1);
      expect(view.definitions[0]!.values.mood).toBe('tense');
      const entry = entriesOf(await readSession(app, session.id))[0]!;
      expect(entry.runs!.map((run) => [run.part, run.position])).toEqual([
        ['reply', 0],
        ['post', 1],
        ['post', 2],
      ]);
      expect(entry.writes.map((write) => write.nodeId)).toEqual(['write', 'write']);
    } finally {
      await app.close();
    }
  });
});
