import { describe, expect, it } from 'vitest';
import type { PortDef } from '@st/shared';
import { descriptors } from './registry.js';
import { stateWrite } from './nodes/state-write/index.js';
import { runNode } from './test-collections.js';
import { SCENE_ID, sceneDefinition, snapshotOf, stateResources } from './test-state.js';

const resources = stateResources(sceneDefinition);
const target = (key: string) => ({ kind: 'definition' as const, definitionId: SCENE_ID, key });
const config = (key: string, op: string) => ({ definitionId: SCENE_ID, key, op });
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, text: id, ...extra });
const mark = (port: PortDef) =>
  `${port.name}:${port.dataType}${port.required ? '!' : port.requiredIfConnected ? '~' : ''}${port.optional ? '?' : ''}`;

describe('State Write ports', () => {
  // `!` required, `~` required only when connected, `?` optional output.
  it.each([
    ['tension', 'set', ['value:number!'], ['value:number']],
    ['tension', 'increment', ['value:number~'], ['value:number']],
    ['tension', 'delete', [], ['value:number']],
    ['mood', 'set', ['value:text!'], ['value:text']],
    ['alarm', 'set', ['value:boolean!'], ['value:boolean']],
    ['note', 'set', ['value:text!'], ['value:text']],
    ['note', 'delete', [], ['value:text']],
    ['data', 'set', ['value:object!'], ['value:object']],
    ['injected', 'add', ['value:any!'], ['value:object']],
    ['injected', 'remove', ['value:text!'], ['value:object?']],
    ['injected', 'delete', [], ['value:array']],
  ])('%s %s takes %j and gives %j', async (key, op, inputs, outputs) => {
    const ports = await stateWrite.resolvePorts!(config(key, op), resources);
    expect(ports.inputs.map(mark)).toEqual(inputs);
    expect(ports.outputs.map(mark)).toEqual(outputs);
  });

  it('defaults to set', async () => {
    const ports = await stateWrite.resolvePorts!({ definitionId: SCENE_ID, key: 'note' }, resources);
    expect(ports.inputs.map(mark)).toEqual(['value:text!']);
  });

  it.each([
    [{}, 'Select a state definition'],
    [{ definitionId: 'missing', key: 'note', op: 'set' }, 'State definition missing not found'],
    [{ definitionId: SCENE_ID, op: 'set' }, 'Select a key'],
    [{ definitionId: SCENE_ID, key: 'nope', op: 'set' }, 'State definition "scene" has no key "nope"'],
    [config('note', 'increment'), `Operation "increment" can't be used on a text key; use set or delete`],
    [config('mood', 'add'), `Operation "add" can't be used on an enum key; use set or delete`],
    [config('tension', 'remove'), `Operation "remove" can't be used on a number key; use set, increment or delete`],
    [config('injected', 'set'), `Operation "set" can't be used on a collection key; use add, remove or delete`],
    [config('injected', 'bogus'), `Operation "bogus" can't be used on a collection key; use add, remove or delete`],
  ])('fails cleanly for %j', async (given, message) => {
    await expect(stateWrite.resolvePorts!(given, resources)).rejects.toThrow(message);
  });

  it('is a State sink with dynamic ports', () => {
    expect(descriptors().find((entry) => entry.type === 'state-write')).toMatchObject({
      dynamicPorts: true,
      sink: true,
      category: 'State',
      label: 'State Write',
    });
  });

  it('refuses a config without a definition or key', () => {
    for (const bad of [
      {},
      { definitionId: SCENE_ID },
      { key: 'note' },
      { definitionId: SCENE_ID, key: 'note', op: 'x' },
    ])
      expect(stateWrite.configSchema.safeParse(bad).success).toBe(false);
    expect(stateWrite.configSchema.parse({ definitionId: SCENE_ID, key: 'note' })).toEqual(config('note', 'set'));
  });
});

describe('State Write run', () => {
  const state = snapshotOf([sceneDefinition], {
    turn: 4,
    keys: {
      'scene.tension': { value: 7, meta: { written: true, writtenAtTurn: 3, turnsSinceWrite: 1 } },
      'scene.injected': {
        value: [item('b', { level: 2 }), item('a')],
        itemTurns: [3, 2],
        meta: { written: true, writtenAtTurn: 3, turnsSinceWrite: 1, count: 2, droppedByCap: 0 },
      },
    },
  });
  const run = (key: string, op: string, value?: unknown, connected = value !== undefined) =>
    runNode(stateWrite, config(key, op), {
      resources,
      state,
      inputs: connected ? { value } : {},
    });
  const set = (key: string, value: unknown) => ({ op: 'set', target: target(key), nodeId: 'state-write', value });
  const del = (key: string) => ({ op: 'delete', target: target(key), nodeId: 'state-write' });

  describe('scalars', () => {
    it.each([
      ['tension', 5, 5],
      ['tension', 0, 0],
      ['tension', 15, 10],
      ['tension', -2, 0],
      ['gold', 1_000_000, 1_000_000],
      ['gold', -4.5, -4.5],
      ['mood', 'tense', 'tense'],
      ['alarm', true, true],
      ['alarm', false, false],
      ['note', 'hello', 'hello'],
      ['note', '', ''],
      ['data', { a: [1, 2] }, { a: [1, 2] }],
      ['data', {}, {}],
    ])('sets %s to %j and stores %j', async (key, value, stored) => {
      const result = await run(key, 'set', value);
      expect(result.output).toEqual({ value: stored });
      expect(result.writes).toEqual([set(key, stored)]);
    });

    it('logs the change, and says when a number was clamped', async () => {
      expect((await run('tension', 'set', 5)).logs).toEqual(['scene.tension: 7 -> 5']);
      expect((await run('tension', 'set', 15)).logs).toEqual([
        "scene.tension: 7 -> 10 (15 clamped to the key's bounds)",
      ]);
      expect((await run('mood', 'set', 'tense')).logs).toEqual(['scene.mood: calm -> tense']);
    });

    it.each([
      ['tension', 'x', 'scene.tension needs a number, got text'],
      ['tension', Number.NaN, 'scene.tension needs a number, got NaN (not a number)'],
      ['tension', Number.POSITIVE_INFINITY, 'scene.tension needs a number, got an infinite number'],
      ['tension', null, 'scene.tension needs a number, got null'],
      ['tension', true, 'scene.tension needs a number, got true'],
      ['alarm', 1, 'scene.alarm needs true or false, got a number'],
      ['alarm', 'true', 'scene.alarm needs true or false, got text'],
      ['note', {}, 'scene.note needs text, got an object'],
      ['note', 5, 'scene.note needs text, got a number'],
      ['data', [], 'scene.data needs an object, got an array'],
      ['data', null, 'scene.data needs an object, got null'],
      ['data', 'x', 'scene.data needs an object, got text'],
      ['mood', 'sad', 'scene.mood must be one of: calm, uneasy, tense; got "sad"'],
      ['mood', 3, 'scene.mood must be one of: calm, uneasy, tense; got a number'],
      ['mood', 'x'.repeat(60), `scene.mood must be one of: calm, uneasy, tense; got "${'x'.repeat(40)}"`],
    ])('refuses to set %s to %j', async (key, value, message) => {
      await expect(run(key, 'set', value)).rejects.toThrow(message);
    });

    it('refuses to set without a value', async () => {
      await expect(run('tension', 'set', undefined, false)).rejects.toThrow(
        'scene.tension needs a number, got nothing',
      );
    });

    it('stores and outputs copies of an object', async () => {
      const value = { nested: { n: 1 } };
      const result = await run('data', 'set', value);
      value.nested.n = 99;
      (result.output.value as typeof value).nested.n = 50;
      expect(result.writes).toEqual([set('data', { nested: { n: 1 } })]);
    });

    it.each(['tension', 'gold', 'mood', 'alarm', 'note', 'data'])('deletes %s back to its default', async (key) => {
      const result = await run(key, 'delete');
      const fresh = {
        tension: 3,
        gold: 0,
        mood: 'calm',
        alarm: false,
        note: 'none',
        data: {},
      }[key];
      expect(result.output).toEqual({ value: fresh });
      expect(result.writes).toEqual([del(key)]);
      expect(result.logs[0]).toContain('reset to');
    });
  });

  describe('increment', () => {
    it.each([
      [2, 9],
      [1, 8],
      [-3, 4],
      [0, 7],
      [0.5, 7.5],
      [5, 10],
      [-20, 0],
    ])('adds %s to the start value 7 and stores %s', async (by, stored) => {
      const result = await run('tension', 'increment', by);
      expect(result.output).toEqual({ value: stored });
      expect(result.writes).toEqual([set('tension', stored)]);
    });

    it('adds 1 when the amount is not connected', async () => {
      const result = await run('tension', 'increment');
      expect(result.output).toEqual({ value: 8 });
      expect(result.writes).toEqual([set('tension', 8)]);
      expect(result.logs).toEqual(['scene.tension: 7 -> 8']);
    });

    it('increments a key nobody wrote from its default', async () => {
      const fresh = snapshotOf([sceneDefinition], { turn: 1 });
      const result = await runNode(stateWrite, config('tension', 'increment'), { resources, state: fresh });
      expect(result.writes).toEqual([set('tension', 4)]);
    });

    it.each([
      ['x', 'scene.tension needs a number, got text'],
      [Number.NaN, 'scene.tension needs a number, got NaN (not a number)'],
      [Number.NEGATIVE_INFINITY, 'scene.tension needs a number, got an infinite number'],
      [null, 'scene.tension needs a number, got null'],
    ])('refuses the amount %j', async (by, message) => {
      await expect(run('tension', 'increment', by, true)).rejects.toThrow(message);
    });
  });

  describe('collections', () => {
    const added = (id: string, extra: Record<string, unknown> = {}) => ({
      op: 'add',
      target: target('injected'),
      nodeId: 'state-write',
      item: item(id, extra),
    });

    it('adds text as an item and outputs the stored item with its id', async () => {
      const result = await run('injected', 'add', 'a storm');
      expect(result.writes).toEqual([added('run:state-write:1', { text: 'a storm' })]);
      expect(result.output).toEqual({ value: { id: 'run:state-write:1', text: 'a storm' } });
    });

    it('keeps the declared fields of an object and leaves out the others', async () => {
      const result = await run('injected', 'add', {
        text: 'a storm',
        level: 3,
        seen: false,
        tag: 'weather',
        extra: 1,
        id: 'mine',
      });
      expect(result.writes).toEqual([
        added('run:state-write:1', { text: 'a storm', level: 3, seen: false, tag: 'weather' }),
      ]);
      expect(result.output.value).toMatchObject({ id: 'run:state-write:1', level: 3 });
      expect(result.logs).toContain("Left out fields the key doesn't declare: extra, id");
    });

    it('omits a declared field that is missing', async () => {
      const result = await run('injected', 'add', { text: 'a storm', level: 2 });
      expect(result.writes).toEqual([added('run:state-write:1', { text: 'a storm', level: 2 })]);
    });

    it('keeps only text and the id for a key that declares no fields', async () => {
      const result = await run('plain', 'add', { text: 'x', level: 3 });
      expect(result.writes).toEqual([
        { op: 'add', target: target('plain'), nodeId: 'state-write', item: item('run:state-write:1', { text: 'x' }) },
      ]);
    });

    it('accepts empty text', async () => {
      expect((await run('plain', 'add', '')).writes).toHaveLength(1);
    });

    it.each([
      [5, 'scene.injected can only add text or an object with a text field, got a number'],
      [{ level: 1 }, 'scene.injected can only add text or an object with a text field, got an object'],
      [{ text: 4 }, 'scene.injected can only add text or an object with a text field, got an object'],
      [['a'], 'scene.injected can only add text or an object with a text field, got an array'],
      [{ text: 'x', level: 'high' }, 'scene.injected: field "level" must be a number, got text'],
      [{ text: 'x', level: Number.NaN }, 'scene.injected: field "level" must be a number, got NaN (not a number)'],
      [{ text: 'x', seen: 'no' }, 'scene.injected: field "seen" must be true or false, got text'],
      [{ text: 'x', tag: 3 }, 'scene.injected: field "tag" must be text, got a number'],
    ])('refuses to add %j', async (value, message) => {
      await expect(run('injected', 'add', value)).rejects.toThrow(message);
    });

    it('removes an item the key held at the start of the turn', async () => {
      const result = await run('injected', 'remove', 'b');
      expect(result.output).toEqual({ value: item('b', { level: 2 }) });
      expect(result.writes).toEqual([{ op: 'remove', target: target('injected'), nodeId: 'state-write', itemId: 'b' }]);
    });

    it('stores nothing and outputs nothing when no item has that id', async () => {
      const result = await run('injected', 'remove', 'zzz');
      expect(result.output).toEqual({});
      expect(result.writes).toEqual([]);
      expect(result.logs).toEqual(['scene.injected: no item has the id zzz; nothing removed']);
    });

    it.each([
      [5, 'got a number'],
      ['  ', 'got text'],
      ['', 'got text'],
      [{ id: 'a' }, 'got an object'],
    ])('refuses to remove %j', async (id, message) => {
      await expect(run('injected', 'remove', id)).rejects.toThrow(
        `scene.injected needs the id of the item to remove, ${message}`,
      );
    });

    it('clears a collection', async () => {
      const result = await run('injected', 'delete');
      expect(result.output).toEqual({ value: [] });
      expect(result.writes).toEqual([del('injected')]);
    });
  });

  it('refuses an operation the key type does not have, with the same message as the ports', async () => {
    await expect(run('note', 'increment', 1)).rejects.toThrow(
      `Operation "increment" can't be used on a text key; use set or delete`,
    );
    await expect(run('injected', 'set', 'x')).rejects.toThrow(
      `Operation "set" can't be used on a collection key; use add, remove or delete`,
    );
  });

  it('fails when the definition or key is missing at run time', async () => {
    await expect(
      runNode(
        stateWrite,
        { definitionId: 'missing', key: 'note', op: 'set' },
        { resources, state, inputs: { value: 'x' } },
      ),
    ).rejects.toThrow('State definition missing not found');
    await expect(
      runNode(
        stateWrite,
        { definitionId: SCENE_ID, key: 'gone', op: 'set' },
        { resources, state, inputs: { value: 'x' } },
      ),
    ).rejects.toThrow('State definition "scene" has no key "gone"');
    await expect(runNode(stateWrite, config('note', 'set'), { resources, inputs: { value: 'x' } })).rejects.toThrow(
      `State definition ${SCENE_ID} not found`,
    );
  });
});
