import { describe, expect, it } from 'vitest';
import type { StateDefinition, StateKeyDef } from '@st/shared';
import { createStateAccess } from './state-access.js';
import { StateWriteBuffer } from './state-writes.js';
import { snapshotOf } from './test-state.js';
import type { StateWriteRequest } from './types.js';

const DEF = '11111111-1111-4111-8111-111111111111';
const definition = (keys: Record<string, StateKeyDef>): StateDefinition => ({
  id: DEF,
  name: 'scene',
  keys,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});
const scene = definition({
  tension: { type: 'number', default: 3, min: 0, max: 10 },
  mood: { type: 'enum', options: ['calm', 'tense'] },
  note: { type: 'text' },
  log: { type: 'collection', cap: 5 },
});
const snapshot = snapshotOf([scene], { keys: { 'scene.tension': { value: 3, meta: { written: true } } } });
const key = (name: string) => ({ kind: 'definition' as const, definitionId: DEF, key: name });
const increment = (by: number, name = 'tension'): StateWriteRequest => ({ target: key(name), op: 'increment', by });
const set = (value: unknown, name = 'tension'): StateWriteRequest => ({ target: key(name), op: 'set', value });
const add = (text: string, extra: Record<string, unknown> = {}): StateWriteRequest => ({
  target: key('log'),
  op: 'add',
  item: { text, ...extra },
});

/** Buffers `requests` per node (all committed in the given wave) and resolves. */
function resolveOf(nodes: Record<string, [wave: number, requests: StateWriteRequest[]]>, from = snapshot) {
  const buffer = new StateWriteBuffer(from, 'run');
  for (const [nodeId, [wave, requests]] of Object.entries(nodes)) {
    const write = buffer.writer(nodeId);
    for (const request of requests) write(request);
    buffer.commit(nodeId, wave);
  }
  return buffer.resolve();
}
const setsOf = (resolved: ReturnType<typeof resolveOf>) =>
  resolved.writes.map((write) => [write.nodeId, write.op, 'value' in write ? write.value : undefined]);

describe('StateWriteBuffer', () => {
  it('mints item ids from the execution, the node and the node’s add count', () => {
    const buffer = new StateWriteBuffer(snapshot, 'exec-1');
    const write = buffer.writer('draw');
    const first = write(add('one'));
    const second = write(add('two', { level: 2 }));
    expect(first.item).toEqual({ text: 'one', id: 'exec-1:draw:1' });
    expect(second.item).toEqual({ text: 'two', level: 2, id: 'exec-1:draw:2' });
    buffer.commit('draw', 1);
    expect(buffer.resolve().writes.map((w) => w.op === 'add' && w.item.id)).toEqual(['exec-1:draw:1', 'exec-1:draw:2']);
  });

  it('keeps item ids unique across nodes and independent of call timing', () => {
    const a = new StateWriteBuffer(snapshot, 'run');
    a.writer('x')(add('1'));
    a.writer('y')(add('2'));
    a.writer('x')(add('3'));
    const ids = (buffer: StateWriteBuffer) => {
      buffer.commit('x', 1);
      buffer.commit('y', 1);
      return buffer.resolve().writes.map((w) => (w.op === 'add' ? [w.nodeId, w.item.text, w.item.id] : []));
    };
    // The same calls in another interleaving give the same ids.
    const b = new StateWriteBuffer(snapshot, 'run');
    b.writer('y')(add('2'));
    b.writer('x')(add('1'));
    b.writer('x')(add('3'));
    expect(ids(a)).toEqual([
      ['x', '1', 'run:x:1'],
      ['x', '3', 'run:x:2'],
      ['y', '2', 'run:y:1'],
    ]);
    expect(ids(b)).toEqual(ids(a));
    expect(new Set(ids(a).map(([, , id]) => id)).size).toBe(3);
  });

  it('ignores an id the request brings and returns a copy of the item', () => {
    const buffer = new StateWriteBuffer(snapshot, 'run');
    const { item } = buffer.writer('n')(add('t', { id: 'client', nested: { a: 1 } }));
    expect(item).toMatchObject({ id: 'run:n:1', text: 't' });
    (item as unknown as { nested: { a: number } }).nested.a = 2;
    buffer.commit('n', 1);
    expect(buffer.resolve().writes[0]).toMatchObject({ item: { nested: { a: 1 } } });
  });

  it('never resolves the requests of a node that did not commit', () => {
    const buffer = new StateWriteBuffer(snapshot, 'run');
    buffer.writer('failed')(set(9));
    buffer.writer('done')(set(5));
    buffer.commit('done', 1);
    expect(setsOf(buffer.resolve())).toEqual([['done', 'set', 5]]);
  });

  it('ignores writes made after the node committed', () => {
    const buffer = new StateWriteBuffer(snapshot, 'run');
    const write = buffer.writer('n');
    write(set(5));
    buffer.commit('n', 1);
    expect(write(set(9))).toEqual({});
    expect(write(add('late'))).toEqual({});
    buffer.commit('n', 2);
    expect(setsOf(buffer.resolve())).toEqual([['n', 'set', 5]]);
  });

  it('copies a request, so the node cannot change it afterwards', () => {
    const buffer = new StateWriteBuffer(snapshot, 'run');
    const value = { a: 1 };
    buffer.writer('n')({ target: { kind: 'node', key: 'k' }, op: 'set', value });
    value.a = 2;
    buffer.commit('n', 1);
    expect(buffer.resolve().writes[0]).toMatchObject({ value: { a: 1 } });
  });

  it('returns a fresh array every time, so a later resolve cannot change an earlier one', () => {
    const buffer = new StateWriteBuffer(snapshot, 'run');
    buffer.writer('n')(set(5));
    buffer.commit('n', 1);
    const first = buffer.resolve();
    expect(buffer.resolve().writes).not.toBe(first.writes);
    buffer.writer('late')(set(9));
    buffer.commit('late', 2);
    expect(first.writes).toHaveLength(1);
    expect(buffer.resolve().writes).toHaveLength(2);
  });

  it('orders by wave, then node id, then call order, whatever the commit order', () => {
    const buffer = new StateWriteBuffer(snapshot, 'run');
    const plan: [string, number, number[]][] = [
      ['z', 1, [1]],
      ['b', 2, [2, 3]],
      ['a', 2, [4]],
      ['c', 1, [5, 6]],
    ];
    for (const [node, , values] of plan) for (const value of values) buffer.writer(node)(set(value, 'note'));
    for (const [node, wave] of [...plan].reverse()) buffer.commit(node, wave);
    expect(buffer.resolve().writes.map((w) => (w.op === 'set' ? [w.nodeId, w.value] : []))).toEqual([
      ['c', 5],
      ['c', 6],
      ['z', 1],
      ['a', 4],
      ['b', 2],
      ['b', 3],
    ]);
  });

  it('writes node targets with the writer’s id, and keeps definition targets as given', () => {
    const resolved = resolveOf({
      draw: [
        1,
        [
          { target: { kind: 'node', key: 'draws' }, op: 'add', item: { text: 'a', entryKey: 'k' } },
          { target: { kind: 'node', key: 'draws' }, op: 'remove', itemId: 'x' },
          { target: { kind: 'node', key: 'last' }, op: 'set', value: 3 },
          { target: { kind: 'node', key: 'draws' }, op: 'delete' },
        ],
      ],
    });
    expect(resolved.writes).toEqual([
      {
        op: 'add',
        target: { kind: 'node', nodeId: 'draw', key: 'draws' },
        nodeId: 'draw',
        item: { text: 'a', entryKey: 'k', id: 'run:draw:1' },
      },
      { op: 'remove', target: { kind: 'node', nodeId: 'draw', key: 'draws' }, nodeId: 'draw', itemId: 'x' },
      { op: 'set', target: { kind: 'node', nodeId: 'draw', key: 'last' }, nodeId: 'draw', value: 3 },
      { op: 'delete', target: { kind: 'node', nodeId: 'draw', key: 'draws' }, nodeId: 'draw' },
    ]);
    expect(resolved.warnings).toEqual([]);
  });
});

describe('resolving writes', () => {
  it('stores an increment as a set with the value after it', () => {
    expect(setsOf(resolveOf({ a: [1, [increment(2)]] }))).toEqual([['a', 'set', 5]]);
  });

  it('computes increments of different nodes from the turn-start value plus the earlier ones', () => {
    // 3 + 1 -> 4, then + 2 -> 6, in node id order.
    expect(setsOf(resolveOf({ b: [1, [increment(2)]], a: [1, [increment(1)]] }))).toEqual([
      ['a', 'set', 4],
      ['b', 'set', 6],
    ]);
  });

  it('carries increments across waves and within one node', () => {
    expect(setsOf(resolveOf({ late: [2, [increment(1)]], early: [1, [increment(1), increment(1)]] }))).toEqual([
      ['early', 'set', 4],
      ['early', 'set', 5],
      ['late', 'set', 6],
    ]);
  });

  it('clamps at every step, so the bounds act between increments', () => {
    expect(setsOf(resolveOf({ a: [1, [increment(20)]], b: [1, [increment(-5)]] }))).toEqual([
      ['a', 'set', 10],
      ['b', 'set', 5],
    ]);
    expect(setsOf(resolveOf({ a: [1, [increment(-20)]], b: [1, [increment(2)]] }))).toEqual([
      ['a', 'set', 0],
      ['b', 'set', 2],
    ]);
  });

  it('continues from a set, and from the default after a delete', () => {
    expect(setsOf(resolveOf({ a: [1, [set(8)]], b: [1, [increment(1)]] }))).toEqual([
      ['a', 'set', 8],
      ['b', 'set', 9],
    ]);
    const resolved = resolveOf({
      a: [1, [increment(5)]],
      b: [1, [{ target: key('tension'), op: 'delete' }]],
      c: [1, [increment(1)]],
    });
    expect(resolved.writes.map((w) => [w.nodeId, w.op, 'value' in w ? w.value : undefined])).toEqual([
      ['a', 'set', 8],
      ['b', 'delete', undefined],
      ['c', 'set', 4],
    ]);
  });

  it('starts from the key’s default when the snapshot has no written value', () => {
    const fresh = snapshotOf([scene]);
    expect(setsOf(resolveOf({ a: [1, [increment(1)]] }, fresh))).toEqual([['a', 'set', 4]]);
  });

  it('keeps other keys’ running values apart', () => {
    const two = definition({ a: { type: 'number' }, b: { type: 'number', default: 10 } });
    const from = snapshotOf([two]);
    const resolved = resolveOf({ n: [1, [increment(1, 'a'), increment(1, 'b'), increment(1, 'a')]] }, from);
    expect(setsOf(resolved)).toEqual([
      ['n', 'set', 1],
      ['n', 'set', 11],
      ['n', 'set', 2],
    ]);
  });

  it('passes adds, removes and sets of definition keys through as stored writes', () => {
    const resolved = resolveOf({
      n: [1, [add('x'), { target: key('log'), op: 'remove', itemId: 'old' }, set('calm', 'mood')]],
    });
    expect(resolved.writes).toEqual([
      {
        op: 'add',
        target: { kind: 'definition', definitionId: DEF, key: 'log' },
        nodeId: 'n',
        item: { text: 'x', id: 'run:n:1' },
      },
      { op: 'remove', target: { kind: 'definition', definitionId: DEF, key: 'log' }, nodeId: 'n', itemId: 'old' },
      { op: 'set', target: { kind: 'definition', definitionId: DEF, key: 'mood' }, nodeId: 'n', value: 'calm' },
    ]);
  });

  it.each<[string, StateWriteRequest, RegExp]>([
    ['an unknown key', set(1, 'nope'), /^A state write to "scene\.nope" was skipped: the key doesn't exist\.$/],
    ['an increment of an unknown key', increment(1, 'nope'), /"scene\.nope" was skipped: the key doesn't exist/],
    [
      'an increment of a text key',
      increment(1, 'note'),
      /"scene\.note" was skipped: it can only increment a number key/,
    ],
    [
      'an unknown definition',
      { target: { kind: 'definition', definitionId: 'gone', key: 'tension' }, op: 'set', value: 1 },
      /^A state write was skipped: state definition gone doesn't exist\.$/,
    ],
    [
      'a key named like an object member',
      set(1, 'constructor'),
      /"scene\.constructor" was skipped: the key doesn't exist/,
    ],
  ])('drops %s with a plain warning', (_, request, warning) => {
    const resolved = resolveOf({ a: [1, [request]], b: [1, [set(7)]] });
    expect(resolved.writes.map((w) => w.nodeId)).toEqual(['b']);
    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toMatch(warning);
  });

  it('drops definition writes when there is no snapshot, but keeps node writes', () => {
    const buffer = new StateWriteBuffer(undefined, 'run');
    const write = buffer.writer('n');
    write(set(1));
    write({ target: { kind: 'node', key: 'k' }, op: 'set', value: 2 });
    buffer.commit('n', 1);
    const resolved = buffer.resolve();
    expect(resolved.writes).toHaveLength(1);
    expect(resolved.warnings).toHaveLength(1);
  });
});

describe('createStateAccess', () => {
  const written = snapshotOf([scene], {
    turn: 4,
    keys: { 'scene.tension': { value: 7, meta: { written: true, writtenAtTurn: 2, turnsSinceWrite: 2 } } },
    nodes: {
      draw: { draws: { value: [{ id: 'i', text: 'a' }], itemTurns: [3], meta: { count: 1, writtenAtTurn: 3 } } },
    },
  });

  it('reads the turn, the template values, definitions, keys and the node’s own keys', () => {
    const access = createStateAccess(written, 'draw');
    expect(access.turn).toBe(4);
    expect(access.values).toEqual({ scene: { tension: 7, mood: 'calm', note: '', log: [] } });
    expect(access.definition(DEF)).toEqual(scene);
    expect(access.read(DEF, 'tension')).toMatchObject({ value: 7, meta: { written: true, writtenAtTurn: 2 } });
    expect(access.read(DEF, 'mood')?.meta).toMatchObject({ written: false, turnsSinceWrite: 4 });
    expect(access.own('draws')).toMatchObject({ value: [{ id: 'i' }], itemTurns: [3] });
  });

  it('returns undefined for what does not exist', () => {
    const access = createStateAccess(written, 'other-node');
    expect(access.definition('nope')).toBeUndefined();
    expect(access.read('nope', 'tension')).toBeUndefined();
    expect(access.read(DEF, 'nope')).toBeUndefined();
    expect(access.read(DEF, 'constructor')).toBeUndefined();
    expect(access.own('draws')).toBeUndefined();
    expect(createStateAccess(written, 'draw').own('toString')).toBeUndefined();
  });

  it('hands out copies, so a node cannot change the snapshot or another node’s view', () => {
    const access = createStateAccess(written, 'draw');
    (access.read(DEF, 'tension') as { value: unknown }).value = 99;
    (access.own('draws')!.value as unknown[]).push('x');
    (access.definition(DEF) as StateDefinition).name = 'changed';
    expect(access.read(DEF, 'tension')?.value).toBe(7);
    expect(access.own('draws')?.value).toHaveLength(1);
    expect(access.definition(DEF)?.name).toBe('scene');
    expect(written.keys[DEF]?.tension?.value).toBe(7);
  });

  it('freezes the shared template values', () => {
    const { values } = createStateAccess(written, 'a');
    expect(() => {
      (values as { scene: { tension: number } }).scene.tension = 0;
    }).toThrow(TypeError);
    expect(() => (values.scene!.log as unknown[]).push(1)).toThrow(TypeError);
    // Passing the values in shares them between nodes (the executor builds them once per run).
    expect(createStateAccess(written, 'b', values).values).toBe(values);
  });

  it('is turn 1 with nothing to read when the run has no snapshot', () => {
    const access = createStateAccess(undefined, 'n');
    expect(access.turn).toBe(1);
    expect(access.values).toEqual({});
    expect(access.read(DEF, 'tension')).toBeUndefined();
    expect(access.own('draws')).toBeUndefined();
    expect(access.definition(DEF)).toBeUndefined();
  });
});
