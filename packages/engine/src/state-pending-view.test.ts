import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ChatMessage, StateDefinition, StateSnapshot, StateWrite, Workflow } from '@st/shared';
import { executeWorkflow } from './executor.js';
import { registry } from './registry.js';
import { StateRun } from './state-writes.js';
import { snapshotOf } from './test-state.js';
import type { NodeDefinition, StateWriteRequest } from './types.js';

// Read-your-own-writes: `StateRun.pendingView` and `ctx.pendingState` over a fake `foldWith`.

const DEF = '11111111-1111-4111-8111-111111111111';
const scene: StateDefinition = {
  id: DEF,
  name: 'scene',
  keys: { tension: { type: 'number', default: 3, min: 0, max: 10 }, log: { type: 'collection' } },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const snapshot = snapshotOf([scene], { turn: 5 });
const key = (name: string) => ({ kind: 'definition' as const, definitionId: DEF, key: name });
const set = (value: unknown): StateWriteRequest => ({ target: key('tension'), op: 'set', value });
const increment = (by: number): StateWriteRequest => ({ target: key('tension'), op: 'increment', by });

/** A stand-in for the caller's fold: tension reads as the value of the last `set` it is given, at turn 5. */
function fakeFold() {
  const calls: StateWrite[][] = [];
  const foldWith = (pending: StateWrite[]): StateSnapshot => {
    calls.push(pending);
    const last = [...pending].reverse().find((write) => write.op === 'set');
    return snapshotOf([scene], {
      turn: 5,
      keys: { 'scene.tension': { value: last?.op === 'set' ? last.value : 3, meta: { written: true } } },
    });
  };
  return { calls, foldWith };
}
const tensionOf = (view: StateSnapshot | undefined) => view?.keys[DEF]?.tension?.value;
const runOf = (foldWith?: (pending: StateWrite[]) => StateSnapshot) =>
  new StateRun(snapshot, { id: 'run', warnings: [] }, 'wf', foldWith);

describe('StateRun.pendingView', () => {
  it('is the run snapshot without a foldWith, writes or not', () => {
    const run = runOf();
    run.context('w', () => true).writeState(set(8));
    expect(run.pendingView('w')).toBe(snapshot);
  });

  it('is the run snapshot, without folding, for a node that has written nothing', () => {
    const { calls, foldWith } = fakeFold();
    const run = runOf(foldWith);
    run.context('w', () => true);
    expect(run.pendingView('w')).toBe(snapshot);
    expect(calls).toEqual([]);
  });

  it('is computed lazily from the node’s resolved requests and handed to foldWith', () => {
    const { calls, foldWith } = fakeFold();
    const run = runOf(foldWith);
    const ctx = run.context('w', () => true);
    ctx.writeState(set(8));
    ctx.writeState({ target: key('log'), op: 'add', item: { text: 'one' } });
    expect(calls).toEqual([]);
    expect(tensionOf(run.pendingView('w'))).toBe(8);
    expect(calls).toHaveLength(1);
    // The stored form: `add` carries its minted item id, the node is the writer.
    expect(calls[0]).toEqual([
      { op: 'set', target: key('tension'), nodeId: 'w', value: 8 },
      { op: 'add', target: key('log'), nodeId: 'w', item: { text: 'one', id: 'run:w:1' } },
    ]);
  });

  it('resolves an increment against the turn-start value, as the final resolve would', () => {
    const { calls, foldWith } = fakeFold();
    const run = runOf(foldWith);
    const ctx = run.context('w', () => true);
    ctx.writeState(increment(2));
    ctx.writeState(increment(9));
    run.pendingView('w');
    expect(calls[0]).toEqual([
      { op: 'set', target: key('tension'), nodeId: 'w', value: 5 },
      { op: 'set', target: key('tension'), nodeId: 'w', value: 10 },
    ]);
  });

  it('is cached until the node’s next write', () => {
    const { calls, foldWith } = fakeFold();
    const run = runOf(foldWith);
    const ctx = run.context('w', () => true);
    ctx.writeState(set(8));
    const first = run.pendingView('w');
    expect(run.pendingView('w')).toBe(first);
    expect(calls).toHaveLength(1);
    ctx.writeState(set(9));
    expect(tensionOf(run.pendingView('w'))).toBe(9);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toHaveLength(2);
  });

  it('shows a node only its own requests', () => {
    const { calls, foldWith } = fakeFold();
    const run = runOf(foldWith);
    run.context('a', () => true).writeState(set(8));
    run.context('b', () => true).writeState(set(2));
    expect(tensionOf(run.pendingView('a'))).toBe(8);
    expect(tensionOf(run.pendingView('b'))).toBe(2);
    expect(calls.map((pending) => pending.map((write) => write.nodeId))).toEqual([['a'], ['b']]);
    // A third node that wrote nothing keeps the snapshot.
    expect(run.pendingView('c')).toBe(snapshot);
  });

  it('does not count a request that resolves to no write (a key the snapshot lacks)', () => {
    const { calls, foldWith } = fakeFold();
    const run = runOf(foldWith);
    run.context('w', () => true).writeState({ target: { ...key('nope') }, op: 'set', value: 1 });
    // The key is unknown to the definition, so the resolver keeps the request out of its writes.
    expect(run.pendingView('w')).toBe(snapshot);
    expect(calls).toEqual([]);
  });

  it('adds nothing to what the run stores, and ignores writes after the node stopped', () => {
    const { foldWith } = fakeFold();
    const run = runOf(foldWith);
    let active = true;
    const ctx = run.context('w', () => active);
    ctx.writeState(set(8));
    run.pendingView('w');
    run.commit('w', 1);
    expect(run.finish()).toEqual([{ op: 'set', target: key('tension'), nodeId: 'w', value: 8 }]);
    active = false;
    ctx.writeState(set(9));
    expect(tensionOf(run.pendingView('w'))).toBe(8);
  });

  it('is undefined for a run without a snapshot', () => {
    expect(new StateRun(undefined, { id: 'run', warnings: [] }, 'wf').pendingView('w')).toBeUndefined();
  });
});

// Through the executor: a node reads its own write, the others keep the turn-start snapshot.
const seeing = (id: string, requests: StateWriteRequest[]): NodeDefinition => ({
  type: id,
  label: id,
  description: '',
  category: '',
  sink: true,
  inputs: [{ name: 'after', label: 'After', dataType: 'any' }],
  outputs: [{ name: 'seen', label: 'Seen', dataType: 'text' }],
  configSchema: z.object({}).passthrough(),
  defaultConfig: {},
  execute: async (ctx) => {
    const before = ctx.pendingState().read(DEF, 'tension')?.value;
    for (const request of requests) ctx.writeState(request);
    return {
      seen: JSON.stringify({
        state: ctx.state.read(DEF, 'tension')?.value,
        before,
        pending: ctx.pendingState().read(DEF, 'tension')?.value,
        template: ctx.state.values,
      }),
    };
  },
});
const TYPES = ['writes-test', 'plain-test'];
afterEach(() => {
  for (const type of TYPES) registry.delete(type);
});
const node = (id: string, type: string) => ({ id, type, config: {}, position: { x: 0, y: 0 } });
const workflow = (): Workflow => ({
  id: 'w',
  name: 'W',
  nodes: [node('input', 'chat-input'), node('writes', 'writes-test'), node('plain', 'plain-test')],
  edges: [],
  createdAt: '',
  updatedAt: '',
});
const options = {
  message: 'hi',
  sessionId: 's',
  history: [] as ChatMessage[],
  secrets: { get: async () => undefined },
};

const outputOf = (log: { output?: unknown } | undefined) => log?.output as { seen: string };

describe('ctx.pendingState', () => {
  const setup = () => {
    registry.set('writes-test', seeing('writes-test', [set(8)]));
    registry.set('plain-test', seeing('plain-test', []));
  };

  it('shows the writing node its own write and nobody else', async () => {
    setup();
    const { calls, foldWith } = fakeFold();
    const { execution } = await executeWorkflow(workflow(), { ...options, state: snapshot, foldWith });
    const seen = (id: string) => JSON.parse(outputOf(execution.nodes[id]).seen);
    expect(seen('writes')).toMatchObject({ state: 3, before: 3, pending: 8, template: { scene: { tension: 3 } } });
    expect(seen('plain')).toMatchObject({ state: 3, before: 3, pending: 3 });
    expect(calls).toHaveLength(1);
  });

  it('reads the snapshot when the caller gave no foldWith', async () => {
    setup();
    const { execution } = await executeWorkflow(workflow(), { ...options, state: snapshot });
    expect(JSON.parse(outputOf(execution.nodes.writes).seen)).toMatchObject({ state: 3, pending: 3 });
  });
});
