import { describe, expect, it } from 'vitest';
import {
  addWrite,
  definition,
  deleteWrite,
  foldTurns,
  idsOf,
  item,
  keyOf,
  nodeAddWrite,
  nodeDeleteWrite,
  nodeSetWrite,
  removeWrite,
  turnEntry,
  valueAt,
} from './test-fixtures.js';
import type { TurnEntry } from './writes.js';

describe('collections', () => {
  const add = (id: string, extra: Record<string, unknown> = {}) => addWrite('log', item(id, id, extra));

  it.each<[string, TurnEntry[], string[], string[]]>([
    ['newest first across turns', [turnEntry('a', [add('1')]), turnEntry('b', [add('2')])], [], ['2', '1']],
    ['items added in one turn come out in reverse write order', [turnEntry('a', [add('1'), add('2')])], [], ['2', '1']],
    [
      'a remove takes the item out',
      [turnEntry('a', [add('1'), add('2')]), turnEntry('b', [removeWrite('log', '1')])],
      [],
      ['2'],
    ],
    [
      'removing an unknown id is a no-op',
      [turnEntry('a', [add('1')]), turnEntry('b', [removeWrite('log', 'zz')])],
      [],
      ['1'],
    ],
    [
      'an add and a remove in the same turn',
      [turnEntry('a', [add('1'), removeWrite('log', '1'), add('2')])],
      [],
      ['2'],
    ],
    [
      'deleting the removing turn brings the item back',
      [turnEntry('a', [add('1')]), turnEntry('b', [removeWrite('log', '1')])],
      ['b'],
      ['1'],
    ],
    [
      'deleting the adding turn drops the item, and the later remove is a no-op',
      [turnEntry('a', [add('1')]), turnEntry('b', [add('2')]), turnEntry('c', [removeWrite('log', '1')])],
      ['a'],
      ['2'],
    ],
    [
      'delete clears what came before it',
      [turnEntry('a', [add('1'), add('2')]), turnEntry('b', [deleteWrite('log'), add('3')])],
      [],
      ['3'],
    ],
    [
      'delete as the last write leaves it empty',
      [turnEntry('a', [add('1')]), turnEntry('b', [deleteWrite('log')])],
      [],
      [],
    ],
    [
      'deleting the clearing turn brings everything back',
      [turnEntry('a', [add('1')]), turnEntry('b', [deleteWrite('log')])],
      ['b'],
      ['1'],
    ],
    [
      'the cap keeps the newest items',
      [turnEntry('a', [add('1'), add('2')]), turnEntry('b', [add('3'), add('4')])],
      [],
      ['4', '3', '2'],
    ],
    [
      'a removed item makes room under the cap',
      [
        turnEntry('a', [add('1'), add('2'), add('3')]),
        turnEntry('b', [add('4')]),
        turnEntry('c', [removeWrite('log', '3')]),
      ],
      [],
      ['4', '2', '1'],
    ],
    [
      'an item of a turn without a reply is gone',
      [turnEntry('a', [add('1')]), turnEntry('b', [add('2')])],
      ['b'],
      ['1'],
    ],
  ])('%s', (_, turns, gone, expected) => {
    expect(idsOf(foldTurns(turns, { gone }), 'log')).toEqual(expected);
  });

  it('reports the count, how many the cap dropped and the turn of each kept item', () => {
    const story = foldTurns([
      turnEntry('a', [addWrite('log', item('1')), addWrite('log', item('2'))]),
      turnEntry('b'),
      turnEntry('c', [addWrite('log', item('3')), addWrite('log', item('4'))]),
    ]);
    expect(idsOf(story, 'log')).toEqual(['4', '3', '2']);
    expect(keyOf(story, 'log').meta).toEqual({
      written: true,
      turnsSinceWrite: 1,
      writtenAtTurn: 3,
      count: 3,
      droppedByCap: 1,
    });
    expect(keyOf(story, 'log').itemTurns).toEqual([3, 3, 1]);
  });

  it('applies a lowered cap to stored items, and a raised one brings them back', () => {
    const turns = [
      turnEntry('a', [addWrite('log', item('1')), addWrite('log', item('2')), addWrite('log', item('3'))]),
    ];
    const capped = (cap?: number) => definition('scene', { log: { type: 'collection', ...(cap && { cap }) } });
    expect(idsOf(foldTurns(turns, { defs: [capped(1)] }), 'log')).toEqual(['3']);
    expect(keyOf(foldTurns(turns, { defs: [capped(1)] }), 'log').meta).toMatchObject({ count: 1, droppedByCap: 2 });
    expect(idsOf(foldTurns(turns, { defs: [capped(5)] }), 'log')).toEqual(['3', '2', '1']);
    expect(idsOf(foldTurns(turns, { defs: [capped()] }), 'log')).toEqual(['3', '2', '1']);
  });

  it('keeps the declared fields and any others on the item', () => {
    const story = foldTurns([turnEntry('a', [add('1', { level: 2, mystery: true })])]);
    expect(valueAt(story, 'log')).toEqual([{ id: '1', text: '1', level: 2, mystery: true }]);
  });

  it('counts a remove of an unknown id as a write for meta', () => {
    const story = foldTurns([turnEntry('a', [removeWrite('log', 'nothing')])]);
    expect(keyOf(story, 'log').meta).toMatchObject({ written: true, writtenAtTurn: 1, count: 0 });
  });
});

describe('node implicit keys', () => {
  const draw = (id: string, node = 'draw-1') => nodeAddWrite(node, 'draws', item(id, id, { entryKey: `k-${id}` }));

  it('folds a collection per node, newest first, with the turns that added each item', () => {
    const story = foldTurns([turnEntry('a', [draw('1')]), turnEntry('b'), turnEntry('c', [draw('2'), draw('3')])]);
    expect(story.nodes).toHaveLength(1);
    expect(story.nodes[0]!.nodeId).toBe('draw-1');
    const draws = story.nodes[0]!.keys.draws!;
    expect((draws.value as { id: string }[]).map((entry) => entry.id)).toEqual(['3', '2', '1']);
    expect(draws.itemTurns).toEqual([3, 3, 1]);
    expect(draws.meta).toEqual({ written: true, turnsSinceWrite: 1, writtenAtTurn: 3, count: 3, droppedByCap: 0 });
  });

  it('has no cap', () => {
    const many = Array.from({ length: 150 }, (_, i) => draw(String(i)));
    expect(foldTurns([turnEntry('a', many)]).nodes[0]!.keys.draws!.meta).toMatchObject({ count: 150 });
  });

  it('keeps two nodes apart and sorts them by node id', () => {
    const story = foldTurns([
      turnEntry('a', [draw('1', 'b-node'), draw('2', 'a-node'), nodeAddWrite('a-node', 'other', item('x'))]),
    ]);
    expect(story.nodes.map((node) => node.nodeId)).toEqual(['a-node', 'b-node']);
    expect(Object.keys(story.nodes[0]!.keys)).toEqual(['draws', 'other']);
  });

  it('drops the node’s keys when its turns lose their replies, and undoes the draw with the reply', () => {
    const turns = [turnEntry('a', [draw('1')]), turnEntry('b', [draw('2')])];
    expect(foldTurns(turns, { gone: ['b'] }).nodes[0]!.keys.draws!.meta).toMatchObject({ count: 1 });
    expect(foldTurns(turns, { gone: ['a', 'b'] }).nodes).toEqual([]);
  });

  it('folds a scalar when only set and delete were written, and reads delete as null', () => {
    const story = foldTurns([
      turnEntry('a', [nodeSetWrite('n', 'last', 7)]),
      turnEntry('b', [nodeSetWrite('n', 'last', 9)]),
    ]);
    expect(story.nodes[0]!.keys.last).toMatchObject({
      value: 9,
      meta: { written: true, writtenAtTurn: 2, turnsSinceWrite: 1 },
    });
    const cleared = foldTurns([
      turnEntry('a', [nodeSetWrite('n', 'last', 7)]),
      turnEntry('b', [nodeDeleteWrite('n', 'last')]),
    ]);
    expect(cleared.nodes[0]!.keys.last!.value).toBeNull();
    expect(cleared.nodes[0]!.keys.last!.meta.written).toBe(true);
  });

  it('removes items and clears like a definition collection', () => {
    const story = foldTurns([
      turnEntry('a', [draw('1'), draw('2')]),
      turnEntry('b', [
        { op: 'remove', target: { kind: 'node', nodeId: 'draw-1', key: 'draws' }, nodeId: 'draw-1', itemId: '1' },
      ]),
    ]);
    expect((story.nodes[0]!.keys.draws!.value as { id: string }[]).map((entry) => entry.id)).toEqual(['2']);
    const cleared = foldTurns([turnEntry('a', [draw('1')]), turnEntry('b', [nodeDeleteWrite('draw-1', 'draws')])]);
    expect(cleared.nodes[0]!.keys.draws!.meta).toMatchObject({ count: 0, written: true });
  });

  it('is not validated against any definition', () => {
    const story = foldTurns([turnEntry('a', [nodeSetWrite('n', 'whatever', { any: ['thing'] })])], { defs: [] });
    expect(story.nodes[0]!.keys.whatever!.value).toEqual({ any: ['thing'] });
    expect(story.definitions).toEqual([]);
  });
});

describe('linked items', () => {
  const messages = { ids: ['m1', 'm2'], fingerprint: 'f' };
  const summary = (id: string) => addWrite('log', item(id, `summary ${id}`, { messages }));

  it('carry their link through the fold unchanged, like any other item property', () => {
    const story = foldTurns([turnEntry('a', [summary('s1')]), turnEntry('b', [addWrite('log', item('plain'))])]);
    expect(valueAt(story, 'log')).toEqual([
      { id: 'plain', text: 'plain' },
      { id: 's1', text: 'summary s1', messages },
    ]);
  });

  it('live and die with the turn that wrote them (and with the writes appended by its post run)', () => {
    const turns = [turnEntry('a', [summary('s1')]), turnEntry('b', [], { postStatus: 'completed' })];
    turns[1]!.writes.push(summary('s2'));
    expect(idsOf(foldTurns(turns), 'log')).toEqual(['s2', 's1']);
    expect(idsOf(foldTurns(turns, { gone: ['b'] }), 'log')).toEqual(['s1']);
    expect(idsOf(foldTurns(turns, { gone: ['a'] }), 'log')).toEqual(['s2']);
  });

  it('keep their own link, and removing one leaves the others', () => {
    const story = foldTurns([
      turnEntry('a', [summary('s1'), summary('s2')]),
      turnEntry('b', [removeWrite('log', 's1'), summary('s3')]),
    ]);
    expect(idsOf(story, 'log')).toEqual(['s3', 's2']);
    expect(keyOf(story, 'log').itemTurns).toEqual([2, 1]);
  });
});
