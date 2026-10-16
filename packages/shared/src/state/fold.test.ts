import { describe, expect, it } from 'vitest';
import { foldStoryState } from './fold.js';
import {
  addWrite,
  DEF,
  definition,
  deleteWrite,
  foldTurns,
  item,
  keyOf,
  OTHER_DEF,
  reply,
  scene,
  setWrite,
  turnEntry,
  userMessage,
  valueAt,
} from './test-fixtures.js';
import type { TurnEntry } from './writes.js';

describe('defaults', () => {
  it('reads every key at its default in a chat with no state', () => {
    const story = foldStoryState({ definitions: [scene], messages: [], state: undefined });
    expect(story.turn).toBe(1);
    expect(story.turns).toEqual([]);
    expect(story.nodes).toEqual([]);
    expect(story.definitions).toHaveLength(1);
    expect(story.definitions[0]).toMatchObject({ definitionId: DEF, name: 'scene', warnings: [] });
    expect(Object.fromEntries(Object.entries(story.definitions[0]!.keys).map(([k, v]) => [k, v.value]))).toEqual({
      tension: 3,
      armed: false,
      mood: 'calm',
      note: 'none',
      extra: { a: 1 },
      log: [],
    });
  });

  it('gives never-written keys meta that treat the chat as written before turn 1', () => {
    const story = foldStoryState({ definitions: [scene], messages: [], state: undefined });
    expect(keyOf(story, 'tension')).toMatchObject({
      meta: { written: false, turnsSinceWrite: 1, writtenAtTurn: null },
      history: [],
    });
    expect(keyOf(story, 'log').meta).toEqual({
      written: false,
      turnsSinceWrite: 1,
      writtenAtTurn: null,
      count: 0,
      droppedByCap: 0,
    });
    expect(keyOf(story, 'log').itemTurns).toEqual([]);
  });

  it('counts a never-written key from the chat start: turnsSinceWrite equals the current turn', () => {
    const story = foldTurns([turnEntry('a'), turnEntry('b'), turnEntry('c')]);
    expect(story.turn).toBe(4);
    expect(keyOf(story, 'tension').meta).toEqual({ written: false, turnsSinceWrite: 4, writtenAtTurn: null });
  });

  it('lists the definitions in the order given and returns fresh defaults', () => {
    const second = definition('second', { n: { type: 'object', default: { x: 1 } } }, { id: OTHER_DEF });
    const story = foldStoryState({ definitions: [second, scene], messages: [], state: undefined });
    expect(story.definitions.map((d) => d.name)).toEqual(['second', 'scene']);
    (story.definitions[0]!.keys.n!.value as { x: number }).x = 2;
    expect(second.keys.n).toEqual({ type: 'object', default: { x: 1 } });
  });
});

describe('scalar values', () => {
  it.each<[string, TurnEntry[], string[], unknown]>([
    [
      'the last present writer wins',
      [turnEntry('a', [setWrite('tension', 5)]), turnEntry('b', [setWrite('tension', 7)])],
      [],
      7,
    ],
    ['a turn that did not write leaves the value', [turnEntry('a', [setWrite('tension', 5)]), turnEntry('b')], [], 5],
    [
      'two writes in one turn: the later one wins',
      [turnEntry('a', [setWrite('tension', 5), setWrite('tension', 6)])],
      [],
      6,
    ],
    [
      'delete goes back to the default',
      [turnEntry('a', [setWrite('tension', 5)]), turnEntry('b', [deleteWrite('tension')])],
      [],
      3,
    ],
    ['a write after a delete counts', [turnEntry('a', [deleteWrite('tension'), setWrite('tension', 8)])], [], 8],
    [
      'a delete after a write in one turn resets',
      [turnEntry('a', [setWrite('tension', 8), deleteWrite('tension')])],
      [],
      3,
    ],
    [
      'deleting the last reply restores the previous turn’s value',
      [turnEntry('a', [setWrite('tension', 5)]), turnEntry('b', [setWrite('tension', 9)])],
      ['b'],
      5,
    ],
    [
      'deleting a middle reply keeps the later value',
      [
        turnEntry('a', [setWrite('tension', 5)]),
        turnEntry('b', [setWrite('tension', 6)]),
        turnEntry('c', [setWrite('tension', 9)]),
      ],
      ['b'],
      9,
    ],
    [
      'deleting the middle reply when the last turn did not write falls back to the earlier write',
      [turnEntry('a', [setWrite('tension', 5)]), turnEntry('b', [setWrite('tension', 6)]), turnEntry('c')],
      ['b'],
      5,
    ],
    ['deleting every reply gives the default', [turnEntry('a', [setWrite('tension', 5)])], ['a'], 3],
    ['a boolean', [turnEntry('a', [setWrite('armed', true)])], [], true],
    ['an enum', [turnEntry('a', [setWrite('mood', 'tense')])], [], 'tense'],
    ['a text', [turnEntry('a', [setWrite('note', '')])], [], ''],
    ['an object', [turnEntry('a', [setWrite('extra', { b: [1, 2] })])], [], { b: [1, 2] }],
    [
      'a write of a turn that never completed and made no reply is not present',
      [turnEntry('a', [setWrite('tension', 5)], { replies: 0, completed: false })],
      [],
      3,
    ],
    [
      'a write of a completed turn that made no reply is present',
      [turnEntry('a', [setWrite('tension', 5)], { replies: 0 })],
      [],
      5,
    ],
    [
      'a write of a failed turn that kept a partial reply is present',
      [turnEntry('a', [setWrite('tension', 5)], { completed: false })],
      [],
      5,
    ],
  ])('%s', (_, turns, gone, expected) => {
    const name = turns.flatMap((t) => t.writes).map((w) => w.target.key)[0] ?? 'tension';
    expect(valueAt(foldTurns(turns, { gone }), name)).toEqual(expected);
  });

  it('ignores the user message when deciding which turns are present', () => {
    const turns = [turnEntry('a', [setWrite('tension', 5)])];
    const story = foldTurns(turns, { gone: ['a'], extraMessages: [userMessage('a')] });
    expect(valueAt(story, 'tension')).toBe(3);
  });

  it('ignores a reply that is still streaming', () => {
    const story = foldStoryState({
      definitions: [scene],
      messages: [reply('a', 'streaming')],
      state: { turns: [turnEntry('a', [setWrite('tension', 5)])] },
    });
    expect(valueAt(story, 'tension')).toBe(3);
  });

  it('keeps every key separate', () => {
    const story = foldTurns([turnEntry('a', [setWrite('tension', 5)]), turnEntry('b', [setWrite('mood', 'tense')])]);
    expect([valueAt(story, 'tension'), valueAt(story, 'mood')]).toEqual([5, 'tense']);
    expect(keyOf(story, 'mood').meta).toMatchObject({ writtenAtTurn: 2, turnsSinceWrite: 1 });
    expect(keyOf(story, 'tension').meta).toMatchObject({ writtenAtTurn: 1, turnsSinceWrite: 2 });
  });

  it('keeps each definition’s keys apart', () => {
    const other = definition('other', { tension: { type: 'number' } }, { id: OTHER_DEF });
    const story = foldTurns([turnEntry('a', [setWrite('tension', 5, OTHER_DEF)])], { defs: [scene, other] });
    expect(valueAt(story, 'tension')).toBe(3);
    expect(story.definitions[1]!.keys.tension!.value).toBe(5);
  });
});

describe('meta', () => {
  const write = (turnId: string, n: number) => turnEntry(turnId, [setWrite('tension', n)]);

  it.each<[string, TurnEntry[], string[], { turn: number; since: number; at: number | null; written: boolean }]>([
    ['a fresh chat', [], [], { turn: 1, since: 1, at: null, written: false }],
    [
      'written in turn 3, now running turn 4',
      [turnEntry('a'), turnEntry('b'), write('c', 1)],
      [],
      { turn: 4, since: 1, at: 3, written: true },
    ],
    [
      'written in turn 1, now running turn 4',
      [write('a', 1), turnEntry('b'), turnEntry('c')],
      [],
      { turn: 4, since: 3, at: 1, written: true },
    ],
    [
      'numbers shift down after an earlier turn is removed',
      [turnEntry('a'), turnEntry('b'), write('c', 1), turnEntry('d')],
      ['a'],
      { turn: 4, since: 2, at: 2, written: true },
    ],
    [
      'the writing turn removed: back to never written',
      [turnEntry('a'), write('b', 1), turnEntry('c')],
      ['b'],
      { turn: 3, since: 3, at: null, written: false },
    ],
    [
      'a delete counts as a write',
      [write('a', 1), turnEntry('b', [deleteWrite('tension')]), turnEntry('c')],
      [],
      { turn: 4, since: 2, at: 2, written: true },
    ],
    [
      'two writing turns: the last one counts',
      [write('a', 1), write('b', 2)],
      [],
      { turn: 3, since: 1, at: 2, written: true },
    ],
  ])('%s', (_, turns, gone, expected) => {
    const story = foldTurns(turns, { gone });
    expect(story.turn).toBe(expected.turn);
    expect(keyOf(story, 'tension').meta).toEqual({
      written: expected.written,
      turnsSinceWrite: expected.since,
      writtenAtTurn: expected.at,
    });
  });
});

describe('purity', () => {
  it('does not change its input and does not alias stored values', () => {
    const turns = [
      turnEntry('a', [setWrite('extra', { deep: { n: 1 } }), addWrite('log', item('1', 'one', { nested: { x: 1 } }))]),
    ];
    const state = { turns };
    const before = structuredClone({ state, scene });
    const story = foldStoryState({ definitions: [scene], messages: [reply('a')], state });
    expect({ state, scene }).toEqual(before);
    (valueAt(story, 'extra') as { deep: { n: number } }).deep.n = 2;
    (valueAt(story, 'log') as { nested: { x: number } }[])[0]!.nested.x = 2;
    expect({ state, scene }).toEqual(before);
  });

  it('survives garbage state and unknown definitions', () => {
    for (const state of [undefined, null, 'x', 7, [], { turns: 'x' }, { turns: [null, 1, 'x'] }])
      expect(foldStoryState({ definitions: [scene], messages: [reply('a')], state }).turn).toBe(1);
  });
});
