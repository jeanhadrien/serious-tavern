import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { registry, type StateAccess } from '@st/engine';
import { withoutLastTurnReplies, type StateWrite } from '@st/shared';
import { createContext } from './context.js';
import { foldRun, startTurn, type PlannedRun } from './services/turn-start.js';
import { regenerate } from './test-support/alternatives.js';
import { waitForPostRun } from './test-support/post.js';
import { define, edge, makeWorkflow, node, send, tempApps, type App } from './test-support/story.js';
import { makeListSession } from './test-support/triggers.js';

// Read-your-own-writes on the server: the `foldWith` of each run is the fold its snapshot came from, plus pending writes.

const apps = tempApps('pending-view');
const PROBE = 'pending-probe-test';
afterEach(async () => {
  registry.delete(PROBE);
  await apps.cleanup();
});

type Seen = { label: string; turn: number; state: Reading; pending: Reading };
type Reading = { n: unknown; items: number; writtenAtTurn: number | null | undefined };

/** A sink that bumps `counter.n`, adds a log item, and records what `ctx.state` and `ctx.pendingState()` then read. */
function probe() {
  const seen: Seen[] = [];
  registry.set(PROBE, {
    type: PROBE,
    label: 'Probe',
    description: '',
    category: 'Tests',
    sink: true,
    inputs: [],
    outputs: [],
    configSchema: z.object({ label: z.string(), definitionId: z.string() }),
    defaultConfig: {},
    async execute(ctx) {
      const { label, definitionId } = ctx.config as { label: string; definitionId: string };
      const reading = (access: StateAccess): Reading => ({
        n: access.read(definitionId, 'n')?.value,
        items: ((access.read(definitionId, 'log')?.value ?? []) as unknown[]).length,
        writtenAtTurn: access.read(definitionId, 'n')?.meta.writtenAtTurn,
      });
      ctx.writeState({ target: { kind: 'definition', definitionId, key: 'n' }, op: 'increment', by: 1 });
      ctx.writeState({ target: { kind: 'definition', definitionId, key: 'log' }, op: 'add', item: { text: label } });
      seen.push({ label, turn: ctx.state.turn, state: reading(ctx.state), pending: reading(ctx.pendingState()) });
      return {};
    },
  });
  return seen;
}

/** A workflow that says "ok" and, when `label` is given, probes. A workflow with no label only probes (no reply). */
async function probingWorkflow(app: App, definitionId: string, label: string, replies: boolean) {
  const probing = node('probe', PROBE, { label, definitionId });
  return makeWorkflow(
    app,
    replies
      ? [node('input', 'chat-input'), probing, node('output', 'chat-output', { template: 'ok' })]
      : [node('input', 'chat-input'), probing],
    replies ? [edge('input', 'message', 'output', 'value')] : [],
    label,
  );
}

describe('a node reading its own writes in a turn of three workflows (two reply, one after)', () => {
  it('sees them in a first and a later run, and in the run after the reply, but never in `state`', async () => {
    const seen = probe();
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const [a, b, c] = [
        await probingWorkflow(app, definition.id, 'A', true),
        await probingWorkflow(app, definition.id, 'B', true),
        await probingWorkflow(app, definition.id, 'C', false),
      ];
      const session = await makeListSession(app, [{ workflowId: a.id }, { workflowId: b.id }, { workflowId: c.id }]);
      expect((await send(app, session.id)).statusCode).toBe(200);
      await waitForPostRun(app, session.id, 'completed');
      // Each run starts from what the ones above it stored; its own write is only in the pending reading.
      expect(seen.map(({ label, turn, state, pending }) => [label, turn, state.n, pending.n])).toEqual([
        ['A', 1, 0, 1],
        ['B', 1, 1, 2],
        ['C', 1, 2, 3],
      ]);
      expect(seen.map(({ state, pending }) => [state.items, pending.items])).toEqual([
        [0, 1],
        [1, 2],
        [2, 3],
      ]);
      // The pending write belongs to the turn being run: the same number `state.turn` already reads.
      expect(seen.map(({ pending }) => pending.writtenAtTurn)).toEqual([1, 1, 1]);
    } finally {
      await app.close();
    }
  });

  it('sees them in a regenerate as the turn it replaces', async () => {
    const seen = probe();
    const { app } = await apps.open();
    try {
      const definition = await define(app);
      const a = await probingWorkflow(app, definition.id, 'A', true);
      const c = await probingWorkflow(app, definition.id, 'C', false);
      const session = await makeListSession(app, [{ workflowId: a.id }, { workflowId: c.id }]);
      expect((await send(app, session.id)).statusCode).toBe(200);
      await waitForPostRun(app, session.id, 'completed');
      seen.length = 0;
      expect((await regenerate(app, session.id)).statusCode).toBe(200);
      // The replaced turn's writes are out of the fold, so the first run starts from nothing again.
      expect(seen[0]).toMatchObject({ label: 'A', turn: 1, state: { n: 0, items: 0 }, pending: { n: 1, items: 1 } });
    } finally {
      await app.close();
    }
  });
});

describe('foldWith', () => {
  const write = (definitionId: string, value: number): StateWrite => ({
    op: 'set',
    target: { kind: 'definition', definitionId, key: 'n' },
    nodeId: 'w',
    value,
  });

  it('gives the run’s own snapshot with no pending writes, and shows a pending one at the turn being run', async () => {
    probe();
    const { app, directory } = await apps.open();
    try {
      const definition = await define(app);
      const workflow = await probingWorkflow(app, definition.id, 'A', true);
      const session = await makeListSession(app, [{ workflowId: workflow.id }]);
      const context = await createContext(directory, { seed: false });
      const started = await startTurn(context, session.id, { content: 'hi' });
      expect(started.foldWith([])).toEqual(started.state);
      const view = started.foldWith([write(definition.id, 4)]);
      expect(view.turn).toBe(started.state.turn);
      expect(view.keys[definition.id]!.n).toMatchObject({ value: 4, meta: { writtenAtTurn: started.state.turn } });
      // The run snapshot itself is untouched.
      expect(started.state.keys[definition.id]!.n!.value).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('does the same for a regenerate’s first run, as the turn it replaces', async () => {
    const seen = probe();
    const { app, directory } = await apps.open();
    try {
      const definition = await define(app);
      const workflow = await probingWorkflow(app, definition.id, 'A', true);
      const session = await makeListSession(app, [{ workflowId: workflow.id }]);
      expect((await send(app, session.id)).statusCode).toBe(200);
      expect(seen).toHaveLength(1);
      const context = await createContext(directory, { seed: false });
      const started = await startTurn(context, session.id, { regenerate: true });
      expect(started.foldWith([])).toEqual(started.state);
      expect(started.state.turn).toBe(1);
      const view = started.foldWith([write(definition.id, 3)]);
      expect(view.keys[definition.id]!.n).toMatchObject({ value: 3, meta: { writtenAtTurn: 1 } });
    } finally {
      await app.close();
    }
  });

  it('does the same for a later run (including the turn), also for a regenerate', async () => {
    const seen = probe();
    const { app, directory } = await apps.open();
    try {
      const definition = await define(app);
      const workflow = await probingWorkflow(app, definition.id, 'A', true);
      const session = await makeListSession(app, [{ workflowId: workflow.id }]);
      expect((await send(app, session.id)).statusCode).toBe(200);
      expect(seen).toHaveLength(1);
      const context = await createContext(directory, { seed: false });
      const stored = (await context.sessions.get(session.id))!;
      const turnId = stored.messages.find((message) => message.role === 'assistant')!.executionId!;
      const planned = { workflow } as unknown as PlannedRun;
      const history = stored.messages;
      const later = foldRun({ definitions: [definition], rootId: undefined, turnId }, stored, planned, history);
      expect(later.foldWith([])).toEqual(later.snapshot);
      expect(later.snapshot.turn).toBe(1);
      expect(later.foldWith([write(definition.id, 4)]).keys[definition.id]!.n).toMatchObject({
        value: 4,
        meta: { writtenAtTurn: 1 },
      });
      // A regenerate's later run folds over the chat without the replaced replies: the turn is the next one, 1 again.
      const without = withoutLastTurnReplies(stored.messages)!;
      const regenerated = foldRun(
        { definitions: [definition], rootId: turnId, turnId: 'new' },
        stored,
        planned,
        without,
      );
      expect(regenerated.foldWith([])).toEqual(regenerated.snapshot);
      expect(regenerated.snapshot.keys[definition.id]!.n!.value).toBe(0);
      expect(regenerated.foldWith([write(definition.id, 2)]).keys[definition.id]!.n).toMatchObject({
        value: 2,
        meta: { writtenAtTurn: 1 },
      });
    } finally {
      await app.close();
    }
  });
});
