import { expect, it } from 'vitest';
import { addWrite, buildView, drawWrite, entry, reply, scene, setWrite, userMessage } from './fixtures.js';
import {
  definitionBlocks,
  hasStoredState,
  kindOf,
  NODE_ITEMS_SHOWN,
  nodeMemory,
  REMOVED_NODE_LABEL,
  turnExecutionId,
} from './storyModel.js';

const twoTurns = () =>
  buildView({
    messages: [userMessage(), reply('e1'), userMessage('u2'), reply('e2')],
    entries: [
      entry('e1', [setWrite('tension', 5), addWrite('injected', 'e1:note:0', 'a bell', { level: 2 })]),
      entry('e2', [
        setWrite('tension', 7),
        addWrite('injected', 'e2:note:0', 'a cart'),
        drawWrite('e2:draw:0', 'resin'),
      ]),
    ],
  });

it('reads a key kind off its value', () => {
  expect([5, true, 'x', [], {}, null, undefined].map(kindOf)).toEqual([
    'number',
    'boolean',
    'text',
    'list',
    'object',
    'object',
    'object',
  ]);
});

it('builds a block per definition with its keys in definition order', () => {
  const [block] = definitionBlocks(twoTurns());
  expect(block).toMatchObject({ id: scene.id, name: 'scene', used: true, warnings: [] });
  expect(block?.keys.map((key) => key.key)).toEqual(Object.keys(scene.keys));
  const tension = block?.keys.find((key) => key.key === 'tension');
  expect(tension).toMatchObject({ kind: 'number', value: 7, written: true, writtenAtTurn: 2 });
  expect(tension?.spark?.points.split(' ')).toHaveLength(2);
  expect(tension?.spark).toMatchObject({ min: 5, max: 7 });
});

it('marks keys nobody wrote and gives them no sparkline', () => {
  const quiet = definitionBlocks(twoTurns())[0]?.keys.find((key) => key.key === 'quiet');
  expect(quiet).toMatchObject({ kind: 'boolean', value: false, written: false, writtenAtTurn: null });
  expect(quiet?.spark).toBeUndefined();
  const level = definitionBlocks(twoTurns())[0]?.keys.find((key) => key.key === 'level');
  expect(level).toMatchObject({ kind: 'number', written: false });
  expect(level?.spark).toBeUndefined();
});

it('lists collection items newest first with their declared fields but not their bookkeeping', () => {
  const injected = definitionBlocks(twoTurns())[0]?.keys.find((key) => key.key === 'injected');
  expect(injected).toMatchObject({ kind: 'list', dropped: 0, written: true });
  expect(injected?.items).toEqual([
    { id: 'e2:note:0', text: 'a cart', extras: [] },
    { id: 'e1:note:0', text: 'a bell', extras: [{ name: 'level', value: '2' }] },
  ]);
  expect(injected?.spark).toBeUndefined();
});

it('reports how many items the cap dropped', () => {
  const capped = { ...scene, keys: { ...scene.keys, injected: { type: 'collection' as const, cap: 2 } } };
  const view = buildView({
    definitions: [capped],
    messages: [reply('e1')],
    entries: [
      entry(
        'e1',
        ['a', 'b', 'c', 'd'].map((text, i) => addWrite('injected', `e1:note:${i}`, text)),
      ),
    ],
  });
  const injected = definitionBlocks(view)[0]?.keys.find((key) => key.key === 'injected');
  expect(injected?.items.map((item) => item.text)).toEqual(['d', 'c']);
  expect(injected?.dropped).toBe(2);
});

it('treats a definition with nothing written and no warning as unused', () => {
  const view = buildView({ messages: [], entries: [] });
  expect(definitionBlocks(view)[0]).toMatchObject({ used: false, warnings: [] });
});

it('treats a warning as use, so a stored value that no longer fits is seen', () => {
  const changed = { ...scene, keys: { ...scene.keys, tension: { type: 'text' as const } } };
  const view = buildView({
    definitions: [changed],
    messages: [reply('e1')],
    entries: [entry('e1', [setWrite('tension', 5)])],
  });
  const [block] = definitionBlocks(view);
  expect(block?.warnings).toHaveLength(1);
  expect(block?.warnings[0]).toMatchObject({ definition: 'scene', key: 'tension' });
  expect(block?.used).toBe(true);
});

it('keeps the view order of several definitions', () => {
  const other = {
    ...scene,
    id: '5d9f7d0e-34a3-4c7b-9b1f-6a3f0f2bb0a2',
    name: 'zeta',
    createdAt: '2026-02-01T00:00:00.000Z',
  };
  const view = buildView({ definitions: [other, scene], messages: [], entries: [] });
  expect(definitionBlocks(view).map((block) => block.name)).toEqual(['scene', 'zeta']);
});

it('lists node memory with the node name, newest first', () => {
  expect(nodeMemory(twoTurns())).toEqual([
    {
      nodeId: 'draw',
      label: 'Draw #1 (draw)',
      keys: [
        expect.objectContaining({
          key: 'draws',
          kind: 'list',
          older: 0,
          items: [{ id: 'e2:draw:0', text: 'resin', extras: [] }],
        }),
      ],
    },
  ]);
});

it('names a node that no longer exists', () => {
  const view = buildView({
    messages: [reply('e1')],
    entries: [entry('e1', [drawWrite('e1:draw:0', 'resin')])],
    nodeLabels: {},
  });
  expect(nodeMemory(view)[0]?.label).toBe(REMOVED_NODE_LABEL);
});

it('shows only the newest node items and counts the older ones, including those the view left out', () => {
  const view = buildView({
    messages: [reply('e1')],
    entries: [
      entry(
        'e1',
        Array.from({ length: 12 }, (_, i) => drawWrite(`e1:draw:${i}`, `smell ${i}`)),
      ),
    ],
  });
  const draws = view.nodes[0];
  if (draws) draws.omitted = { draws: 5 };
  const [memory] = nodeMemory(view);
  expect(memory?.keys[0]?.items).toHaveLength(NODE_ITEMS_SHOWN);
  expect(memory?.keys[0]?.items[0]?.text).toBe('smell 11');
  expect(memory?.keys[0]?.older).toBe(5 + 12 - NODE_ITEMS_SHOWN);
});

it('has no node memory without node writes', () => {
  expect(nodeMemory(buildView({ messages: [], entries: [] }))).toEqual([]);
});

it('says whether a turn that still counts stored anything', () => {
  expect(hasStoredState(twoTurns())).toBe(true);
  expect(hasStoredState(buildView({ messages: [], entries: [] }))).toBe(false);
  expect(hasStoredState(buildView({ messages: [reply('e1')], entries: [entry('e1')] }))).toBe(false);
  // Its reply is gone: the turn no longer counts, so what it wrote is not state.
  expect(
    hasStoredState(buildView({ messages: [userMessage()], entries: [entry('e1', [setWrite('tension', 5)])] })),
  ).toBe(false);
});

it('finds the run of a numbered turn', () => {
  const view = twoTurns();
  expect(turnExecutionId(view, 1)).toBe('e1');
  expect(turnExecutionId(view, 2)).toBe('e2');
  expect(turnExecutionId(view, 3)).toBeUndefined();
  expect(turnExecutionId(view, 0)).toBeUndefined();
});

it('numbers around a turn whose replies were deleted', () => {
  const view = buildView({
    messages: [reply('e1'), reply('e3')],
    entries: [entry('e1', [setWrite('tension', 5)]), entry('e2', [setWrite('tension', 6)]), entry('e3', [])],
  });
  expect(turnExecutionId(view, 2)).toBe('e3');
});
