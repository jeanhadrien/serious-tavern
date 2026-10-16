import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ChatMessage, Edge, StateDefinition, Workflow } from '@st/shared';
import { ExecutionFailure, executeWorkflow } from './executor.js';
import { registry } from './registry.js';
import { snapshotOf } from './test-state.js';
import type { NodeDefinition, StateWriteRequest } from './types.js';

const DEF = '11111111-1111-4111-8111-111111111111';
const scene: StateDefinition = {
  id: DEF,
  name: 'scene',
  keys: {
    tension: { type: 'number', default: 3, min: 0, max: 10 },
    mood: { type: 'enum', options: ['calm', 'tense'] },
    log: { type: 'collection' },
  },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const snapshot = snapshotOf([scene], { turn: 5, keys: { 'scene.tension': { value: 3, meta: { written: true } } } });
const key = (name: string) => ({ kind: 'definition' as const, definitionId: DEF, key: name });
const increment = (by: number): StateWriteRequest => ({ target: key('tension'), op: 'increment', by });
const set = (value: unknown, name = 'tension'): StateWriteRequest => ({ target: key(name), op: 'set', value });

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const graph = (nodes: Workflow['nodes'], edges: Edge[]): Workflow => ({
  id: 'w',
  name: 'W',
  nodes,
  edges,
  createdAt: '',
  updatedAt: '',
});
const options = {
  message: 'hello',
  sessionId: 'session',
  history: [] as ChatMessage[],
  secrets: { get: async () => undefined },
  state: snapshot,
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A throwaway sink that asks for the `requests` in its config, optionally waits, fails or ignores aborts, and
// outputs what it could read of the turn-start state.
type Plan = {
  requests?: StateWriteRequest[];
  delayMs?: number;
  fail?: boolean;
  late?: StateWriteRequest[];
  ignoreAbort?: boolean;
  // Returned instead of `seen`, to break the output contract after having asked for writes.
  output?: Record<string, unknown>;
};
const writer = (): NodeDefinition => ({
  type: 'writer-test',
  label: 'writer-test',
  description: '',
  category: '',
  sink: true,
  inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
  outputs: [{ name: 'seen', label: 'Seen', dataType: 'text', optional: true }],
  configSchema: z.object({}).passthrough(),
  defaultConfig: {},
  timeoutMs: 2000,
  execute: async (ctx) => {
    const plan = ctx.config as Plan;
    for (const request of plan.requests ?? []) ctx.writeState(request);
    if (plan.delayMs) {
      if (plan.ignoreAbort) await sleep(plan.delayMs);
      else
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, plan.delayMs);
          ctx.signal.addEventListener('abort', () => (clearTimeout(timer), reject(ctx.signal.reason)), { once: true });
        });
    }
    for (const request of plan.late ?? []) ctx.writeState(request);
    if (plan.fail) throw new Error('boom');
    if (plan.output) return plan.output;
    return { seen: String(ctx.state.read(DEF, 'tension')?.value) };
  },
});
// An upstream node that produces nothing, so what hangs below it is skipped.
const gate = (): NodeDefinition => ({
  ...writer(),
  type: 'gate-test',
  sink: false,
  inputs: [],
  outputs: [{ name: 'out', label: 'Out', dataType: 'text', optional: true }],
  execute: async () => ({}),
});
// Reports the state it sees as the reply text.
const reader = (): NodeDefinition => ({
  ...writer(),
  type: 'reader-test',
  sink: false,
  outputs: [{ name: 'text', label: 'Text', dataType: 'text' }],
  execute: async (ctx) => ({
    text: JSON.stringify({
      read: ctx.state.read(DEF, 'tension')?.value,
      own: ctx.state.own('x'),
      values: ctx.state.values,
      turn: ctx.trigger.turn,
      stateTurn: ctx.state.turn,
    }),
  }),
});

const TYPES = ['writer-test', 'gate-test', 'reader-test', 'short-test', 'strict-test'];
const register = () => {
  registry.set('writer-test', writer());
  registry.set('gate-test', gate());
  registry.set('reader-test', reader());
  // Gives up after 40ms (the executor's deadline), whatever the node is still doing.
  registry.set('short-test', { ...writer(), type: 'short-test', timeoutMs: 40 });
  // Like the writer, but its `seen` output is required once connected.
  registry.set('strict-test', {
    ...writer(),
    type: 'strict-test',
    outputs: [{ name: 'seen', label: 'Seen', dataType: 'text' }],
  });
};
afterEach(() => {
  for (const type of TYPES) registry.delete(type);
});

// The Chat Output echoes the message unless `extraEdges` reach it (then they must wire its `value` themselves).
const withWriters = (plans: Record<string, Plan>, extraNodes: Workflow['nodes'] = [], extraEdges: Edge[] = []) =>
  graph(
    [
      node('input', 'chat-input'),
      node('output', 'chat-output'),
      ...Object.entries(plans).map(([id, plan]) => node(id, 'writer-test', plan)),
      ...extraNodes,
    ],
    extraEdges.some((e) => e.target === 'output')
      ? extraEdges
      : [edge('input', 'message', 'output', 'value'), ...extraEdges],
  );

describe('state writes in a run', () => {
  it('returns the writes of the nodes that completed, with the writer, as the stored form', async () => {
    register();
    const result = await executeWorkflow(
      withWriters({ w: { requests: [increment(2), set('tense', 'mood')] } }),
      options,
    );
    expect(result.writes).toEqual([
      { op: 'set', target: key('tension'), nodeId: 'w', value: 5 },
      { op: 'set', target: key('mood'), nodeId: 'w', value: 'tense' },
    ]);
    expect(result.execution.warnings).toEqual([]);
  });

  it('runs a writer that no Chat Output depends on (it is a sink)', async () => {
    register();
    const result = await executeWorkflow(withWriters({ w: { requests: [set(9)] } }), options);
    expect(result.execution.nodes.w?.status).toBe('completed');
    expect(result.writes).toHaveLength(1);
  });

  it('mints item ids from the execution id and the node', async () => {
    register();
    const request: StateWriteRequest = { target: key('log'), op: 'add', item: { text: 'a' } };
    const result = await executeWorkflow(withWriters({ w: { requests: [request, request] } }), {
      ...options,
      executionId: 'exec-7',
    });
    expect(result.writes.map((write) => write.op === 'add' && write.item.id)).toEqual(['exec-7:w:1', 'exec-7:w:2']);
  });

  it('never shows a write to the reads of the same run, in a later wave or a template', async () => {
    register();
    const wf = withWriters(
      { w: { requests: [set(9)] } },
      [node('after', 'reader-test')],
      [edge('w', 'seen', 'after', 'value'), edge('after', 'text', 'output', 'value')],
    );
    const result = await executeWorkflow(wf, options);
    // The reader runs in a later wave than the writer and still sees the turn-start value.
    expect(result.execution.nodes.after?.status).toBe('completed');
    expect(JSON.parse(result.replies[0]!.content)).toMatchObject({ read: 3, values: { scene: { tension: 3 } } });
    expect(result.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'w', value: 9 }]);
  });

  it('applies the writes of nodes that ran in different waves in wave order, whatever their ids', async () => {
    register();
    // The later wave has the smaller id, so ordering by id alone would put it first.
    const wf = withWriters(
      { 'z-first': { requests: [increment(1)] }, 'a-second': { requests: [increment(2)] } },
      [],
      [edge('z-first', 'seen', 'a-second', 'value')],
    );
    const result = await executeWorkflow(wf, options);
    const { nodes } = result.execution;
    expect(Date.parse(nodes['a-second']!.startedAt!)).toBeGreaterThanOrEqual(Date.parse(nodes['z-first']!.finishedAt!));
    expect(result.writes.map((write) => [write.nodeId, write.op === 'set' && write.value])).toEqual([
      ['z-first', 4],
      ['a-second', 6],
    ]);
  });

  it('orders writes by wave and node id, not by which node finished first', async () => {
    register();
    // `b` takes longest and `a` is instant, `c` is in a later wave but would finish before `b`.
    const wf = withWriters(
      {
        b: { requests: [increment(2)], delayMs: 60 },
        a: { requests: [increment(1)] },
        c: { requests: [increment(4)] },
      },
      [],
      [edge('a', 'seen', 'c', 'value')],
    );
    const result = await executeWorkflow(wf, options);
    expect(result.writes.map((write) => [write.nodeId, write.op === 'set' && write.value])).toEqual([
      ['a', 4],
      ['b', 6],
      ['c', 10],
    ]);
  });

  it('writes nothing for a node that errors after asking, and keeps the completed ones on the failure', async () => {
    register();
    const wf = withWriters({ ok: { requests: [set(7)] }, bad: { requests: [set(9)], fail: true } });
    const failure = await executeWorkflow(wf, options).catch((error) => error);
    expect(failure).toBeInstanceOf(ExecutionFailure);
    expect(failure.nodeId).toBe('bad');
    // Same wave: `ok` finished before `bad` failed.
    expect(failure.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'ok', value: 7 }]);
  });

  it.each([
    [
      'returns a port it does not have',
      { requests: [set(9)], output: { nope: 1 } },
      'Node returned invalid output ports',
    ],
    ['omits a connected required output', { requests: [set(9)], output: {} }, 'Node did not produce output "seen"'],
  ])('writes nothing for a node that asks and then %s', async (_, plan, error) => {
    register();
    // `ok` completes in the same wave and keeps its write; `bad` fails the contract after asking for one.
    const wf = withWriters(
      { ok: { requests: [set(7)] }, tail: {} },
      [node('bad', 'strict-test', plan)],
      [edge('input', 'message', 'output', 'value'), edge('bad', 'seen', 'tail', 'value')],
    );
    const failure = await executeWorkflow(wf, options).catch((cause) => cause);
    expect(failure).toBeInstanceOf(ExecutionFailure);
    expect(failure.nodeId).toBe('bad');
    expect(failure.execution.nodes.bad).toMatchObject({ status: 'error', error });
    expect(failure.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'ok', value: 7 }]);
  });

  it('writes nothing for a cancelled sibling', async () => {
    register();
    const wf = withWriters({
      slow: { requests: [set(9)], delayMs: 500 },
      bad: { requests: [set(8)], fail: true, delayMs: 20 },
    });
    const failure = await executeWorkflow(wf, options).catch((error) => error);
    expect(failure.execution.nodes.slow?.status).toBe('cancelled');
    expect(failure.writes).toEqual([]);
  });

  it('keeps the writes of earlier waves when a later wave fails', async () => {
    register();
    const wf = withWriters(
      { first: { requests: [set(6)] }, second: { requests: [set(1)], fail: true } },
      [],
      [edge('first', 'seen', 'second', 'value')],
    );
    const failure = await executeWorkflow(wf, options).catch((error) => error);
    expect(failure.nodeId).toBe('second');
    expect(failure.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'first', value: 6 }]);
    expect(failure.replies.map((reply: { content: string }) => reply.content)).toEqual(['hello']);
  });

  it('keeps the writes of completed nodes when the run is stopped', async () => {
    register();
    const controller = new AbortController();
    const wf = withWriters(
      { first: { requests: [set(6)] }, second: { requests: [set(1)], delayMs: 2000 } },
      [],
      [edge('first', 'seen', 'second', 'value')],
    );
    setTimeout(() => controller.abort(new Error('stopped')), 60);
    const failure = await executeWorkflow(wf, { ...options, signal: controller.signal }).catch((error) => error);
    expect(failure).toBeInstanceOf(ExecutionFailure);
    expect(failure.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'first', value: 6 }]);
  });

  it('is not changed by detached work that writes after the run failed', async () => {
    register();
    const wf = withWriters({ ok: { requests: [set(7)] } }, [
      node('detached', 'short-test', { requests: [set(1)], delayMs: 150, ignoreAbort: true, late: [set(2), set(3)] }),
    ]);
    const failure = await executeWorkflow(wf, options).catch((error) => error);
    expect(failure.execution.nodes.detached).toMatchObject({ status: 'error', error: 'timed out after 40ms' });
    const returned = JSON.stringify(failure.writes);
    // The node is still running when the failure is thrown, and asks for more once it wakes up.
    await sleep(300);
    expect(JSON.stringify(failure.writes)).toBe(returned);
    expect(failure.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'ok', value: 7 }]);
  });

  it('writes nothing for a skipped node', async () => {
    register();
    const wf = withWriters(
      { w: { requests: [set(9)] } },
      [node('gate', 'gate-test')],
      [edge('gate', 'out', 'w', 'value')],
    );
    const result = await executeWorkflow(wf, options);
    expect(result.execution.nodes.w?.status).toBe('skipped');
    expect(result.writes).toEqual([]);
  });

  it('reports a request for a key that does not exist as a warning, on success and on failure', async () => {
    register();
    const bad = set(1, 'nope');
    const result = await executeWorkflow(withWriters({ w: { requests: [bad, set(2)] } }), options);
    expect(result.writes).toHaveLength(1);
    expect(result.execution.warnings).toEqual(['A state write to "scene.nope" was skipped: the key doesn\'t exist.']);
    const failure = await executeWorkflow(
      withWriters({ w: { requests: [bad] }, x: { fail: true, delayMs: 10 } }),
      options,
    ).catch((error) => error);
    expect(failure.execution.warnings).toContain('A state write to "scene.nope" was skipped: the key doesn\'t exist.');
  });

  it('resolves the writes once: the result is stable', async () => {
    register();
    const result = await executeWorkflow(withWriters({ w: { requests: [increment(1)] } }), options);
    expect(result.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'w', value: 4 }]);
  });

  it('gives a run with no snapshot no turn, no reads, and drops definition writes with a warning', async () => {
    register();
    const wf = withWriters(
      { w: { requests: [set(9)] } },
      [node('after', 'reader-test')],
      [edge('w', 'seen', 'after', 'value'), edge('after', 'text', 'output', 'value')],
    );
    const { state: _, ...bare } = options;
    const result = await executeWorkflow(wf, bare);
    const seen = JSON.parse(result.replies[0]!.content);
    expect(seen.turn).toBeUndefined();
    expect(seen).toMatchObject({ stateTurn: 1, values: {} });
    expect(seen.read).toBeUndefined();
    expect(result.writes).toEqual([]);
    expect(result.execution.warnings[0]).toMatch(/doesn't exist/);
  });
});

describe('trigger.turn and state reads', () => {
  it('sets trigger.turn and state.turn from the snapshot', async () => {
    register();
    const wf = graph(
      [node('input', 'chat-input'), node('after', 'reader-test'), node('output', 'chat-output')],
      [edge('input', 'message', 'after', 'value'), edge('after', 'text', 'output', 'value')],
    );
    const result = await executeWorkflow(wf, options);
    expect(JSON.parse(result.replies[0]!.content)).toMatchObject({ turn: 5, stateTurn: 5, read: 3 });
  });

  it('hands every node the same frozen template values, and copies of keys', async () => {
    register();
    registry.set('reader-test', {
      ...reader(),
      execute: async (ctx) => {
        let threw = false;
        try {
          (ctx.state.values as { scene: { tension: number } }).scene.tension = 0;
        } catch {
          threw = true;
        }
        const view = ctx.state.read(DEF, 'tension');
        if (view) view.value = 99;
        return { text: JSON.stringify({ threw, again: ctx.state.read(DEF, 'tension')?.value }) };
      },
    });
    const wf = graph(
      [node('input', 'chat-input'), node('after', 'reader-test'), node('output', 'chat-output')],
      [edge('input', 'message', 'after', 'value'), edge('after', 'text', 'output', 'value')],
    );
    expect(JSON.parse((await executeWorkflow(wf, options)).replies[0]!.content)).toEqual({ threw: true, again: 3 });
  });
});
