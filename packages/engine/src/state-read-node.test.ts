import { describe, expect, it } from 'vitest';
import type { PortDef, StateDefinition, Workflow } from '@st/shared';
import { descriptors } from './registry.js';
import { pruneInvalidEdges } from './prune.js';
import { stateRead } from './nodes/state-read/index.js';
import { runNode } from './test-collections.js';
import { SCENE_ID, sceneDefinition, snapshotOf, stateResources } from './test-state.js';

const resources = stateResources(sceneDefinition);
const ports = (config: Record<string, unknown>, from = resources) => stateRead.resolvePorts!(config, from);
const outputs = async (config: Record<string, unknown>) => (await ports(config)).outputs;
const summary = (list: PortDef[]) => list.map((port) => `${port.name}:${port.dataType}${port.optional ? '?' : ''}`);
const read = (key: string, mode: 'value' | 'meta' | 'linked' = 'value') => ({
  definitionId: SCENE_ID,
  key,
  read: mode,
});
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, text: id, ...extra });

describe('State Read ports', () => {
  it.each([
    ['tension', 'number'],
    ['alarm', 'boolean'],
    ['mood', 'text'],
    ['note', 'text'],
    ['data', 'object'],
    ['injected', 'array'],
  ])('reads %s as one %s output called value', async (key, type) => {
    expect(summary(await outputs(read(key)))).toEqual([`value:${type}`]);
  });

  it('defaults to reading the value', async () => {
    expect(summary(await outputs({ definitionId: SCENE_ID, key: 'tension' }))).toEqual(['value:number']);
  });

  it('offers the facts about a key, and the count only for a collection', async () => {
    expect(summary(await outputs(read('tension', 'meta')))).toEqual([
      'written:boolean',
      'turnsSinceWrite:number',
      'writtenAtTurn:number?',
    ]);
    expect(summary(await outputs(read('injected', 'meta')))).toEqual([
      'written:boolean',
      'turnsSinceWrite:number',
      'writtenAtTurn:number?',
      'count:number',
    ]);
  });

  it('offers the intact linked items of a collection as one array output called value', async () => {
    expect(summary(await outputs(read('injected', 'linked')))).toEqual(['value:array']);
    expect(summary(await outputs(read('plain', 'linked')))).toEqual(['value:array']);
  });

  it.each(['tension', 'note', 'data', 'mood', 'alarm'])('refuses the linked read for the %s key', async (key) => {
    await expect(ports(read(key, 'linked'))).rejects.toThrow(`is a`);
    await expect(ports(read(key, 'linked'))).rejects.toThrow(`"linked" needs a collection key`);
  });

  it.each([
    [{}, 'Select a state definition'],
    [{ definitionId: '', key: 'tension' }, 'Select a state definition'],
    [{ definitionId: 'missing', key: 'tension' }, 'State definition missing not found'],
    [{ definitionId: SCENE_ID }, 'Select a key'],
    [{ definitionId: SCENE_ID, key: 'nope' }, 'State definition "scene" has no key "nope"'],
    [{ definitionId: SCENE_ID, key: 'toString' }, 'State definition "scene" has no key "toString"'],
    [{ definitionId: 7, key: 'tension' }, 'Select a state definition'],
    [{ definitionId: SCENE_ID, key: 'tension', read: 'everything' }, 'Unknown read "everything"'],
  ])('fails cleanly for %j', async (config, message) => {
    await expect(ports(config)).rejects.toThrow(message);
  });

  it('fails cleanly when the run has no state definitions at all', async () => {
    await expect(ports(read('tension'), { presets: { get: async () => undefined } })).rejects.toThrow(
      `State definition ${SCENE_ID} not found`,
    );
  });

  it('is a dynamic-port node of the State category', () => {
    expect(descriptors().find((item) => item.type === 'state-read')).toMatchObject({
      dynamicPorts: true,
      sink: false,
      category: 'State',
      label: 'State Read',
    });
  });
});

describe('State Read edges', () => {
  const workflow = (edgeFrom: string, config: Record<string, unknown>): Workflow => ({
    id: 'w',
    name: 'W',
    nodes: [
      { id: 'r', type: 'state-read', config, position: { x: 0, y: 0 } },
      { id: 'out', type: 'chat-output', config: {}, position: { x: 0, y: 0 } },
    ],
    edges: [{ id: 'e', source: 'r', sourceHandle: edgeFrom, target: 'out', targetHandle: 'value' }],
    createdAt: '',
    updatedAt: '',
  });

  it('prunes the edge from a port that disappears', async () => {
    // `count` only exists for a collection: pointing the node at a number key removes it.
    expect((await pruneInvalidEdges(workflow('count', read('injected', 'meta')), resources)).edges).toHaveLength(1);
    expect((await pruneInvalidEdges(workflow('count', read('tension', 'meta')), resources)).edges).toHaveLength(0);
    expect((await pruneInvalidEdges(workflow('value', read('tension', 'meta')), resources)).edges).toHaveLength(0);
  });

  it('keeps the edges when the ports cannot be resolved', async () => {
    for (const config of [read('gone'), { ...read('tension'), definitionId: 'missing' }, {}])
      expect((await pruneInvalidEdges(workflow('value', config), resources)).edges).toHaveLength(1);
    expect(
      (await pruneInvalidEdges(workflow('value', read('tension')), { presets: { get: async () => undefined } })).edges,
    ).toHaveLength(1);
  });
});

describe('State Read run', () => {
  const state = snapshotOf([sceneDefinition], {
    turn: 6,
    keys: {
      'scene.tension': { value: 7, meta: { written: true, writtenAtTurn: 4, turnsSinceWrite: 2 } },
      'scene.injected': {
        value: [item('b', { level: 2 }), item('a')],
        itemTurns: [5, 3],
        meta: { written: true, writtenAtTurn: 5, turnsSinceWrite: 1, count: 2, droppedByCap: 0 },
      },
    },
  });
  const run = (config: Record<string, unknown>, snapshot = state) =>
    runNode(stateRead, config, { resources, state: snapshot });

  describe('the linked read', () => {
    const linkedItem = (id: string, status: string, first: number | undefined, ids = [`m${first}`]) =>
      item(id, {
        messages: { ids, fingerprint: 'f' },
        link: { status, ids, ...(first === undefined ? {} : { first }) },
      });
    const held = [
      linkedItem('late', 'intact', 21, ['m21', 'm22']),
      linkedItem('broken', 'changed', 11, ['m11']),
      item('plain'),
      linkedItem('early', 'intact', 1, ['m1', 'm2']),
      linkedItem('twin', 'intact', 21, ['m21', 'm22']),
      linkedItem('gone', 'gone', undefined, ['m5']),
    ];
    const snapshot = snapshotOf([sceneDefinition], {
      keys: { 'scene.plain': { value: held, meta: { written: true, count: held.length } } },
    });

    it('gives the intact linked items in chat order, dropping broken, plain and duplicate ones', async () => {
      const result = await run(read('plain', 'linked'), snapshot);
      expect((result.output.value as { id: string }[]).map((entry) => entry.id)).toEqual(['early', 'late']);
      expect(result.logs).toEqual(['scene.plain: 2 of 6 items are linked and intact']);
    });

    it('keeps the computed link on the items it gives', async () => {
      const [first] = (await run(read('plain', 'linked'), snapshot)).output.value as { link: unknown }[];
      expect(first!.link).toEqual({ status: 'intact', ids: ['m1', 'm2'], first: 1 });
    });

    it('gives an empty list for a key nobody wrote', async () => {
      expect((await run(read('injected', 'linked'))).output).toEqual({ value: [] });
    });

    it('is an error for a key that is not a collection', async () => {
      await expect(run(read('tension', 'linked'))).rejects.toThrow(
        'scene.tension is a number key; "linked" needs a collection key',
      );
    });
  });

  it('outputs the default of a key nobody wrote', async () => {
    expect((await run(read('mood'))).output).toEqual({ value: 'calm' });
    expect((await run(read('note'))).output).toEqual({ value: 'none' });
    expect((await run(read('data'))).output).toEqual({ value: {} });
    expect((await run(read('plain'))).output).toEqual({ value: [] });
  });

  it('outputs the value as the turn started, and the items of a collection newest first', async () => {
    expect((await run(read('tension'))).output).toEqual({ value: 7 });
    expect((await run(read('injected'))).output).toEqual({ value: [item('b', { level: 2 }), item('a')] });
  });

  it('outputs the facts: written at a turn, or never written', async () => {
    expect((await run(read('tension', 'meta'))).output).toEqual({
      written: true,
      turnsSinceWrite: 2,
      writtenAtTurn: 4,
    });
    // Never written counts as written before turn 1; there is no writtenAtTurn to output.
    expect((await run(read('mood', 'meta'))).output).toEqual({ written: false, turnsSinceWrite: 6 });
    expect((await run(read('injected', 'meta'))).output).toEqual({
      written: true,
      turnsSinceWrite: 1,
      writtenAtTurn: 5,
      count: 2,
    });
    expect((await run(read('plain', 'meta'))).output).toEqual({ written: false, turnsSinceWrite: 6, count: 0 });
  });

  it('hands out a copy of the value', async () => {
    const first = (await run(read('injected'))).output.value as Array<Record<string, unknown>>;
    first[0]!.text = 'changed';
    first.pop();
    expect((await run(read('injected'))).output.value).toEqual([item('b', { level: 2 }), item('a')]);
  });

  it('logs the key and what it saw, cut at 200 characters', async () => {
    expect((await run(read('tension'))).logs).toEqual(['scene.tension = 7']);
    expect((await run(read('tension', 'meta'))).logs).toEqual([
      'scene.tension: written at turn 4, 2 turns since write',
    ]);
    expect((await run(read('mood', 'meta'))).logs).toEqual(['scene.mood: never written, 6 turns since write']);
    const long: StateDefinition = { ...sceneDefinition, keys: { note: { type: 'text' } } };
    const text = 'x'.repeat(500);
    const logs = (
      await runNode(
        stateRead,
        { definitionId: SCENE_ID, key: 'note' },
        {
          resources: stateResources(long),
          state: snapshotOf([long], { keys: { 'scene.note': { value: text } } }),
        },
      )
    ).logs;
    expect(logs[0]).toBe(`scene.note = ${'x'.repeat(200)}…`);
  });

  it('fails with the same plain errors when the definition or key is missing at run time', async () => {
    await expect(run({ definitionId: 'missing', key: 'tension' })).rejects.toThrow(
      'State definition missing not found',
    );
    await expect(run(read('nope'))).rejects.toThrow('State definition "scene" has no key "nope"');
    // A run without a story state has no definitions to read.
    await expect(runNode(stateRead, read('tension'), { resources })).rejects.toThrow(
      `State definition ${SCENE_ID} not found`,
    );
  });
});
