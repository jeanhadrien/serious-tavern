import { afterEach, describe, expect, it } from 'vitest';
import { errorEnvelopeSchema, turnEventSchema } from '@st/shared';
import { gateNode, stateView } from './test-support/post.js';
import { parseEventStream } from './test-support/event-stream.js';
import {
  assistantRows,
  define,
  edge,
  entriesOf,
  makeSession,
  makeWorkflow,
  node,
  readExecution,
  readSession,
  send,
  tempApps,
} from './test-support/story.js';
import { bumpingWorkflow, makeListSession, patchSession, sayingWorkflow, sendTurn } from './test-support/triggers.js';

// A chat's reply list: the enabled workflows run one after another as one turn.

const apps = tempApps('triggers-reply');
afterEach(() => apps.cleanup());

async function open() {
  const { app, directory } = await apps.open();
  return { app, directory, definition: await define(app) };
}

describe('a turn of two workflows', () => {
  it('runs them in list order, the second on what the first wrote and replied, as one turn', async () => {
    const { app, definition } = await open();
    try {
      const one = await bumpingWorkflow(app, definition.id, 'One', 'one n={{state.counter.n}} hist={{history.length}}');
      const two = await sayingWorkflow(
        app,
        'Two',
        'two n={{state.counter.n}} hist={{#each history}}{{role}} {{/each}}turn={{trigger.turn}} msg={{trigger.message}}',
      );
      const session = await makeListSession(app, [{ workflowId: one.id }, { workflowId: two.id }]);
      const result = await sendTurn(app, session.id, 'hello');
      expect(result.assistantMessages.map((message) => message.content)).toEqual([
        'one n=0 hist=0',
        // The first run's write (n=1) is there, and the chat as it stands: the user message, then the first reply. The
        // turn and the message are the same for both.
        'two n=1 hist=user assistant turn=1 msg=hello',
      ]);
      // `execution` is the first run's log, `executions` all of them in order; the turn is the first run's id.
      expect(result.executions!.map((log) => log.workflowId)).toEqual([one.id, two.id]);
      expect(result.execution!.id).toBe(result.executions![0]!.id);
      const [first, second] = result.executions!;
      const saved = await readSession(app, session.id);
      expect(saved.messages.map((message) => [message.role, message.executionId])).toEqual([
        ['user', first!.id],
        ['assistant', first!.id],
        ['assistant', first!.id],
      ]);
      expect(assistantRows(saved).map((message) => message.runId)).toEqual([first!.id, second!.id]);
      // One entry for the turn, with a record per run, and every run's log is saved under its own id.
      const [entry, ...others] = entriesOf(saved);
      expect(others).toEqual([]);
      expect(entry).toMatchObject({ executionId: first!.id, completed: true, replies: 2 });
      expect(entry!.runs).toEqual([
        { executionId: first!.id, workflowId: one.id, part: 'reply', status: 'completed' },
        { executionId: second!.id, workflowId: two.id, part: 'reply', status: 'completed' },
      ]);
      expect((await readExecution(app, second!.id)).workflowId).toBe(two.id);
      // The next turn is turn 2 for both.
      expect((await sendTurn(app, session.id, 'again')).assistantMessages.map((message) => message.content)).toEqual([
        'one n=1 hist=3',
        'two n=2 hist=user assistant assistant user assistant turn=2 msg=again',
      ]);
      const view = await stateView(app, session.id);
      expect(view.turns[0]!.runs).toMatchObject([
        { workflowId: one.id, workflowName: 'One', part: 'reply', status: 'completed' },
        { workflowId: two.id, workflowName: 'Two', part: 'reply', status: 'completed' },
      ]);
      expect(view.turns[0]).not.toHaveProperty('postStatus');
    } finally {
      await app.close();
    }
  });

  it('streams a run.start before each run and tags the node events with their run', async () => {
    const { app } = await open();
    try {
      const one = await sayingWorkflow(app, 'One', 'one');
      const two = await sayingWorkflow(app, 'Two', 'two');
      const session = await makeListSession(app, [{ workflowId: one.id }, { workflowId: two.id }]);
      const response = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/messages/stream`,
        payload: { content: 'go' },
      });
      const frames = parseEventStream(response.body).map((frame) => turnEventSchema.parse(frame.data));
      const starts = frames.flatMap((frame, index) => (frame.type === 'run.start' ? [{ frame, index }] : []));
      expect(frames[0]!.type).toBe('turn.start');
      expect(starts.map(({ frame }) => [frame.workflowId, frame.workflowName])).toEqual([
        [one.id, 'One'],
        [two.id, 'Two'],
      ]);
      const [a, b] = starts.map(({ frame }) => (frame as { runId: string }).runId);
      expect(frames[0]).toMatchObject({ executionId: a });
      const nodeRuns = frames.flatMap((frame, index) =>
        frame.type.startsWith('node.') ? [{ index, runId: (frame as { runId?: string }).runId }] : [],
      );
      // Every node event has a run id; those of the first run come after its run.start and before the second's.
      expect(nodeRuns.every((item) => item.runId === a || item.runId === b)).toBe(true);
      expect(
        nodeRuns
          .filter((item) => item.runId === a)
          .every((item) => item.index > starts[0]!.index && item.index < starts[1]!.index),
      ).toBe(true);
      expect(nodeRuns.filter((item) => item.runId === b).every((item) => item.index > starts[1]!.index)).toBe(true);
      const done = frames.at(-1)!;
      expect(done).toMatchObject({ type: 'turn.complete' });
      expect((done as { executions: unknown[] }).executions).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('skips disabled entries, and answers NO_ENABLED_WORKFLOW with nothing stored when none is enabled', async () => {
    const { app } = await open();
    try {
      const one = await sayingWorkflow(app, 'One', 'one');
      const two = await sayingWorkflow(app, 'Two', 'two');
      const session = await makeListSession(app, [{ workflowId: one.id, enabled: false }, { workflowId: two.id }]);
      const result = await sendTurn(app, session.id);
      expect(result.assistantMessages.map((message) => message.content)).toEqual(['two']);
      expect(entriesOf(await readSession(app, session.id))[0]!.runs!.map((run) => run.workflowId)).toEqual([two.id]);

      const none = await makeListSession(app, [{ workflowId: one.id, enabled: false }]);
      const refused = await send(app, none.id, 'hi');
      expect(refused.statusCode).toBe(400);
      expect(errorEnvelopeSchema.parse(refused.json()).error.code).toBe('NO_ENABLED_WORKFLOW');
      const stored = await readSession(app, none.id);
      expect(stored.messages).toEqual([]);
      expect(entriesOf(stored)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('answers WORKFLOW_INVALID for an invalid enabled workflow before storing anything, and ignores an invalid disabled one', async () => {
    const { app } = await open();
    try {
      const good = await sayingWorkflow(app, 'Good', 'good');
      const broken = await makeWorkflow(app, [node('input', 'chat-input')], [], 'Broken');
      const session = await makeListSession(app, [{ workflowId: good.id }, { workflowId: broken.id }]);
      const refused = await send(app, session.id, 'hi');
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error).toMatchObject({ code: 'WORKFLOW_INVALID', details: { workflowId: broken.id } });
      expect((await readSession(app, session.id)).messages).toEqual([]);
      await patchSession(app, session.id, {
        triggers: {
          reply: [
            { workflowId: good.id, enabled: true },
            { workflowId: broken.id, enabled: false },
          ],
        },
      });
      expect(await sendTurn(app, session.id)).toMatchObject({ assistantMessages: [{ content: 'good' }] });
    } finally {
      await app.close();
    }
  });
});

describe('a run that fails or is stopped', () => {
  it('keeps going: the failing run is reported by name after the later runs ran', async () => {
    const { app } = await open();
    try {
      const failing = await makeWorkflow(
        app,
        [node('input', 'chat-input'), node('parse', 'parse-json'), node('output', 'chat-output')],
        [edge('input', 'message', 'parse', 'text'), edge('parse', 'value', 'output', 'value')],
        'Parser',
      );
      const fine = await sayingWorkflow(app, 'Fine', 'still here');
      const session = await makeListSession(app, [{ workflowId: failing.id }, { workflowId: fine.id }]);
      const response = await send(app, session.id, 'not json');
      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.error.code).toBe('WORKFLOW_EXECUTION_FAILED');
      expect(body.error.message).toMatch(/^Workflow "Parser" failed: /);
      // The failing run's log is `execution`; every run's is in `executions`, with every saved message.
      expect(body.error.details.execution.workflowId).toBe(failing.id);
      expect(body.error.details.executions.map((log: { workflowId: string }) => log.workflowId)).toEqual([
        failing.id,
        fine.id,
      ]);
      expect(body.error.details.assistantMessages.map((message: { content: string }) => message.content)).toEqual([
        'still here',
      ]);
      const [entry] = entriesOf(await readSession(app, session.id));
      expect(entry).toMatchObject({ completed: false, replies: 1 });
      expect(entry!.runs!.map((run) => [run.workflowId, run.status])).toEqual([
        [failing.id, 'error'],
        [fine.id, 'completed'],
      ]);
      expect(entry!.runs![0]!.error).toContain('Parse JSON');
    } finally {
      await app.close();
    }
  });

  it('reports a chat of one workflow exactly as before: the message does not name the workflow', async () => {
    const { app } = await open();
    try {
      const failing = await makeWorkflow(
        app,
        [node('input', 'chat-input'), node('parse', 'parse-json'), node('output', 'chat-output')],
        [edge('input', 'message', 'parse', 'text'), edge('parse', 'value', 'output', 'value')],
        'Parser',
      );
      const session = await makeSession(app, failing.id);
      const body = (await send(app, session.id, 'not json')).json();
      expect(body.error.message).toMatch(/^Parse JSON \(parse\): /);
    } finally {
      await app.close();
    }
  });

  it('stops the running run and does not run the rest of the list', async () => {
    const gate = gateNode();
    const { app } = await open();
    try {
      const held = await makeWorkflow(
        app,
        [node('input', 'chat-input'), node('gate', 'post-gate-test'), node('output', 'chat-output')],
        [edge('input', 'message', 'gate', 'value'), edge('gate', 'value', 'output', 'value')],
        'Held',
      );
      const later = await sayingWorkflow(app, 'Later', 'never');
      const session = await makeListSession(app, [{ workflowId: held.id }, { workflowId: later.id }]);
      const running = send(app, session.id);
      await gate.started;
      expect((await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` })).statusCode).toBe(204);
      const response = await running;
      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.error.code).toBe('TURN_STOPPED');
      expect(body.error.details.executions).toHaveLength(1);
      expect(body.error.details.execution.workflowId).toBe(held.id);
      const saved = await readSession(app, session.id);
      // Only the stopped run is recorded: the workflow after it did not start.
      const [entry] = entriesOf(saved);
      expect(entry).toMatchObject({ completed: false });
      expect(entry!.runs!.map((run) => [run.workflowId, run.status])).toEqual([[held.id, 'stopped']]);
      expect(assistantRows(saved)).toEqual([]);
      expect(gate.runs).toBe(1);
    } finally {
      gate.dispose();
      await app.close();
    }
  });

  it('keeps what the runs before the stopped one saved, and drops the ones after it', async () => {
    const gate = gateNode();
    const { app } = await open();
    try {
      const quick = await sayingWorkflow(app, 'Quick', 'quick');
      const held = await makeWorkflow(
        app,
        [node('input', 'chat-input'), node('gate', 'post-gate-test'), node('output', 'chat-output')],
        [edge('input', 'message', 'gate', 'value'), edge('gate', 'value', 'output', 'value')],
        'Held',
      );
      const never = await sayingWorkflow(app, 'Never', 'never');
      const session = await makeListSession(app, [
        { workflowId: quick.id },
        { workflowId: held.id },
        { workflowId: never.id },
      ]);
      const running = send(app, session.id);
      await gate.started;
      await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` });
      expect((await running).statusCode).toBe(409);
      const saved = await readSession(app, session.id);
      expect(assistantRows(saved).map((message) => message.content)).toEqual(['quick']);
      expect(entriesOf(saved)[0]!.runs!.map((run) => [run.workflowId, run.status])).toEqual([
        [quick.id, 'completed'],
        [held.id, 'stopped'],
      ]);
    } finally {
      gate.dispose();
      await app.close();
    }
  });
});
