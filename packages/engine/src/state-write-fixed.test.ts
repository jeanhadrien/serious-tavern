import { describe, expect, it } from 'vitest';
import type { PortDef } from '@st/shared';
import { validateWorkflow } from './executor.js';
import { stateWrite } from './nodes/state-write/index.js';
import { edge, graph, node, runNode } from './test-collections.js';
import { SCENE_ID, newChat, playTurn, sceneDefinition, snapshotOf, stateResources } from './test-state.js';

// The State Write node's optional fixed `value` setting: stored when nothing is connected to the Value input.

const resources = stateResources(sceneDefinition);
const target = (key: string) => ({ kind: 'definition' as const, definitionId: SCENE_ID, key });
const config = (key: string, op: string, value?: unknown) => ({
  definitionId: SCENE_ID,
  key,
  op,
  ...(value === undefined ? {} : { value }),
});
const mark = (port: PortDef) =>
  `${port.name}:${port.dataType}${port.required ? '!' : port.requiredIfConnected ? '~' : ''}`;
const state = snapshotOf([sceneDefinition], {
  turn: 4,
  keys: {
    'scene.tension': { value: 7, meta: { written: true, writtenAtTurn: 3, turnsSinceWrite: 1 } },
    'scene.injected': {
      value: [{ id: 'b', text: 'b' }],
      itemTurns: [3],
      meta: { written: true, writtenAtTurn: 3, turnsSinceWrite: 1, count: 1, droppedByCap: 0 },
    },
  },
});
const run = (key: string, op: string, value?: unknown, input?: { value: unknown }) =>
  runNode(stateWrite, config(key, op, value), { resources, state, inputs: input ?? {} });
const set = (key: string, value: unknown) => ({ op: 'set', target: target(key), nodeId: 'state-write', value });

describe('State Write fixed value: ports', () => {
  // `!` required, `~` required only when connected. A fixed value makes the Value input optional.
  it.each([
    ['tension', 'set', 5, ['value:number~', 'when:any~']],
    ['mood', 'set', 'tense', ['value:text~', 'when:any~']],
    ['alarm', 'set', false, ['value:boolean~', 'when:any~']],
    ['note', 'set', '', ['value:text~', 'when:any~']],
    ['data', 'set', {}, ['value:object~', 'when:any~']],
    ['tension', 'increment', 2, ['value:number~', 'when:any~']],
    ['injected', 'add', 'a storm', ['value:any~', 'messages:any~', 'when:any~']],
    ['injected', 'remove', 'b', ['value:text~', 'when:any~']],
    ['tension', 'delete', 5, ['when:any~']],
  ])('%s %s with the fixed value %j takes %j', async (key, op, value, inputs) => {
    const ports = await stateWrite.resolvePorts!(config(key, op, value), resources);
    expect(ports.inputs.map(mark)).toEqual(inputs);
  });

  it.each([
    ['tension', 'set', ['value:number!', 'when:any~']],
    ['injected', 'add', ['value:any!', 'messages:any~', 'when:any~']],
    ['injected', 'remove', ['value:text!', 'when:any~']],
  ])('%s %s still needs the Value input without one', async (key, op, inputs) => {
    expect((await stateWrite.resolvePorts!(config(key, op), resources)).inputs.map(mark)).toEqual(inputs);
    // A cleared setting (null) is none, like a missing one.
    expect((await stateWrite.resolvePorts!({ ...config(key, op), value: null }, resources)).inputs.map(mark)).toEqual(
      inputs,
    );
  });

  it('keeps the output and the gate as they are', async () => {
    const plain = await stateWrite.resolvePorts!(config('tension', 'set'), resources);
    const fixed = await stateWrite.resolvePorts!(config('tension', 'set', 5), resources);
    expect(fixed.outputs).toEqual(plain.outputs);
    expect(fixed.inputs.at(-1)).toEqual(plain.inputs.at(-1));
  });

  it('accepts any JSON as the setting and leaves it out of the parsed config when absent', () => {
    for (const value of [5, 'x', true, false, null, { text: 'a', level: 1 }, ['a']])
      expect(stateWrite.configSchema.safeParse({ ...config('note', 'set'), value }).success).toBe(true);
    expect(Object.hasOwn(stateWrite.configSchema.parse(config('note', 'set')), 'value')).toBe(false);
    expect(stateWrite.defaultConfig).not.toHaveProperty('value');
  });
});

describe('State Write fixed value: run', () => {
  it.each([
    ['tension', 5, 5],
    ['tension', 0, 0],
    ['tension', 15, 10],
    ['tension', -2, 0],
    ['mood', 'tense', 'tense'],
    ['alarm', true, true],
    ['alarm', false, false],
    ['note', 'hello', 'hello'],
    // Empty text is a value, not "no value".
    ['note', '', ''],
    ['data', { a: [1, 2] }, { a: [1, 2] }],
  ])('sets %s to the fixed %j and stores %j', async (key, value, stored) => {
    const result = await run(key, 'set', value);
    expect(result.output).toEqual({ value: stored });
    expect(result.writes).toEqual([set(key, stored)]);
    expect(result.logs[0]).toContain(`scene.${key}:`);
  });

  it('increments by the fixed amount, from the start value, clamped', async () => {
    for (const [by, stored] of [
      [2, 9],
      [-3, 4],
      [0.5, 7.5],
      [5, 10],
    ] as const) {
      const result = await run('tension', 'increment', by);
      expect(result.output).toEqual({ value: stored });
      expect(result.writes).toEqual([set('tension', stored)]);
    }
  });

  it('increments by 1 when there is neither an amount nor a fixed value', async () => {
    expect((await run('tension', 'increment')).writes).toEqual([set('tension', 8)]);
    // A cleared setting is none.
    expect((await run('tension', 'increment', null)).writes).toEqual([set('tension', 8)]);
  });

  it('adds a fixed text or object as an item, with the key’s declared fields', async () => {
    const text = await run('injected', 'add', 'a storm');
    expect(text.output).toEqual({ value: { id: 'run:state-write:1', text: 'a storm' } });
    expect(text.writes).toEqual([
      {
        op: 'add',
        target: target('injected'),
        nodeId: 'state-write',
        item: { id: 'run:state-write:1', text: 'a storm' },
      },
    ]);
    const object = await run('injected', 'add', { text: 'a storm', level: 3, extra: 1 });
    expect(object.output.value).toEqual({ id: 'run:state-write:1', text: 'a storm', level: 3 });
    expect(object.logs).toContain("Left out fields the key doesn't declare: extra");
  });

  it('removes the item with the fixed id', async () => {
    const result = await run('injected', 'remove', 'b');
    expect(result.output).toEqual({ value: { id: 'b', text: 'b' } });
    expect(result.writes).toEqual([{ op: 'remove', target: target('injected'), nodeId: 'state-write', itemId: 'b' }]);
    expect((await run('injected', 'remove', 'zzz')).writes).toEqual([]);
  });

  it('ignores the setting when it deletes', async () => {
    const result = await run('tension', 'delete', 5);
    expect(result.writes).toEqual([{ op: 'delete', target: target('tension'), nodeId: 'state-write' }]);
    expect(result.output).toEqual({ value: 3 });
  });

  it('stores a copy of a fixed object', async () => {
    const value = { nested: { n: 1 } };
    const result = await run('data', 'set', value);
    value.nested.n = 99;
    (result.output.value as typeof value).nested.n = 50;
    expect(result.writes).toEqual([set('data', { nested: { n: 1 } })]);
  });

  it('prefers a connected value to the fixed one', async () => {
    expect((await run('mood', 'set', 'tense', { value: 'calm' })).writes).toEqual([set('mood', 'calm')]);
    expect((await run('tension', 'set', 5, { value: 2 })).writes).toEqual([set('tension', 2)]);
    expect((await run('tension', 'increment', 5, { value: 2 })).writes).toEqual([set('tension', 9)]);
    expect((await run('injected', 'add', 'fixed', { value: 'connected' })).writes[0]).toMatchObject({
      item: { text: 'connected' },
    });
    expect((await run('injected', 'remove', 'zzz', { value: 'b' })).writes).toHaveLength(1);
  });

  it('checks a connected value on its own: a bad one is not rescued by the fixed one', async () => {
    await expect(run('tension', 'set', 5, { value: 'x' })).rejects.toThrow('scene.tension needs a number, got text');
  });

  it.each([
    ['tension', 'set', 'x', 'scene.tension needs a number, got text'],
    ['tension', 'set', true, 'scene.tension needs a number, got true'],
    ['tension', 'increment', 'x', 'scene.tension needs a number, got text'],
    ['alarm', 'set', 1, 'scene.alarm needs true or false, got a number'],
    ['note', 'set', 5, 'scene.note needs text, got a number'],
    ['data', 'set', [], 'scene.data needs an object, got an array'],
    ['data', 'set', 'x', 'scene.data needs an object, got text'],
    ['mood', 'set', 'sad', 'scene.mood must be one of: calm, uneasy, tense; got "sad"'],
    ['mood', 'set', 3, 'scene.mood must be one of: calm, uneasy, tense; got a number'],
    ['injected', 'add', 5, 'scene.injected can only add text or an object with a text field, got a number'],
    ['injected', 'add', { text: 'x', level: 'high' }, 'scene.injected: field "level" must be a number, got text'],
    ['injected', 'remove', 5, 'scene.injected needs the id of the item to remove, got a number'],
    ['injected', 'remove', '  ', 'scene.injected needs the id of the item to remove, got text'],
  ])('refuses the fixed value in %s %s: %j', async (key, op, value, message) => {
    await expect(run(key, op, value)).rejects.toThrow(message);
  });

  it('still refuses to set when there is neither a value nor a fixed one', async () => {
    await expect(run('tension', 'set')).rejects.toThrow('scene.tension needs a number, got nothing');
    await expect(run('tension', 'set', null)).rejects.toThrow('scene.tension needs a number, got nothing');
  });
});

describe('State Write fixed value: in a workflow', () => {
  const write = (extra: Record<string, unknown>) => ({ definitionId: SCENE_ID, key: 'mood', op: 'set', ...extra });
  const wired = (config_: Record<string, unknown>, connect: boolean) =>
    graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('mark', 'state-write', config_),
        node('text', 'chat-output', { order: 1 }),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        ...(connect ? [edge('input', 'message', 'mark', 'value')] : []),
        edge('mark', 'value', 'text', 'value'),
      ],
    );

  it('needs the Value input without a fixed value, and not with one', async () => {
    const chat = newChat([sceneDefinition]);
    const without = await validateWorkflow(wired(write({}), false), chat.resources);
    expect(without.map((issue) => issue.message)).toHaveLength(1);
    expect(without[0]!.message).toMatch(/State Write #1 \(state-write\)/);
    expect(await validateWorkflow(wired(write({ value: 'tense' }), false), chat.resources)).toEqual([]);
    // A cleared (null) setting is no setting.
    expect(await validateWorkflow(wired(write({ value: null }), false), chat.resources)).toHaveLength(1);
  });

  it('writes the fixed value every turn with nothing connected, and its output feeds a reply', async () => {
    const chat = newChat([sceneDefinition]);
    const wf = wired(write({ value: 'tense' }), false);
    const first = await playTurn(chat, wf, 'e1');
    expect(first.writes).toEqual([{ op: 'set', target: target('mood'), nodeId: 'mark', value: 'tense' }]);
    expect(first.replies.map((reply) => reply.content)).toEqual(['go', 'tense']);
    expect((await playTurn(chat, wf, 'e2')).writes).toHaveLength(1);
  });

  it('uses the connected value instead of the fixed one', async () => {
    const chat = newChat([sceneDefinition]);
    const result = await playTurn(chat, wired(write({ value: 'tense' }), true), 'e1', 'uneasy');
    expect(result.writes).toEqual([{ op: 'set', target: target('mood'), nodeId: 'mark', value: 'uneasy' }]);
  });

  it('fails the node, in plain words, when the fixed value does not fit', async () => {
    const chat = newChat([sceneDefinition]);
    await expect(playTurn(chat, wired(write({ value: 'sad' }), false), 'e1')).rejects.toThrow(
      'scene.mood must be one of: calm, uneasy, tense; got "sad"',
    );
  });

  it('increments by a fixed amount with nothing connected', async () => {
    const chat = newChat([sceneDefinition]);
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('bump', 'state-write', { definitionId: SCENE_ID, key: 'tension', op: 'increment', value: 2 }),
      ],
      [edge('input', 'message', 'output', 'value')],
    );
    const values = [];
    for (const id of ['e1', 'e2', 'e3']) {
      const result = await playTurn(chat, wf, id);
      values.push(result.writes.map((item) => item.op === 'set' && item.value));
    }
    // 3 (default) + 2, then +2 twice more, clamped at the key's max of 10.
    expect(values).toEqual([[5], [7], [9]]);
  });
});
