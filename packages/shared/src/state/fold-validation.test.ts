import { describe, expect, it } from 'vitest';
import { foldStoryState } from './fold.js';
import {
  addWrite,
  definition,
  deleteWrite,
  foldTurns,
  item,
  keyOf,
  OTHER_DEF,
  removeWrite,
  reply,
  scene,
  setWrite,
  turnEntry,
  valueAt,
} from './test-fixtures.js';

describe('validation against the current definition', () => {
  const stored = (name: string, v: unknown) => [turnEntry('a', [setWrite(name, v)])];
  const warnings = (story: ReturnType<typeof foldTurns>) => story.definitions[0]!.warnings;

  it.each<[string, string, unknown, unknown, string]>([
    ['a number above max', 'tension', 11, 3, 'Stored value 11 is above max 10; using default 3'],
    ['a number below min', 'tension', -1, 3, 'Stored value -1 is below min 0; using default 3'],
    ['a number stored as text', 'tension', '5', 3, 'Stored value "5" is not a number; using default 3'],
    ['null for a number', 'tension', null, 3, 'Stored value null is not a number; using default 3'],
    ['a text for a boolean', 'armed', 'yes', false, 'Stored value "yes" is not true or false; using default false'],
    [
      'an option that was removed',
      'mood',
      'happy',
      'calm',
      'Stored value "happy" is not one of: calm, uneasy, tense; using default "calm"',
    ],
    ['a number for a text', 'note', 5, 'none', 'Stored value 5 is not text; using default "none"'],
    ['an array for an object', 'extra', [1], { a: 1 }, 'Stored value [1] is not an object; using default {"a":1}'],
  ])('reads %s as the default, with a warning', (_, name, stored_, expected, message) => {
    const story = foldTurns(stored(name, stored_));
    expect(valueAt(story, name)).toEqual(expected);
    expect(warnings(story)).toEqual([{ definition: 'scene', key: name, message }]);
    // The key still counts as written.
    expect(keyOf(story, name).meta).toMatchObject({ written: true, writtenAtTurn: 1 });
  });

  it('judges only the latest write: an older bad value is not reported', () => {
    const story = foldTurns([turnEntry('a', [setWrite('tension', 99)]), turnEntry('b', [setWrite('tension', 4)])]);
    expect(valueAt(story, 'tension')).toBe(4);
    expect(warnings(story)).toEqual([]);
  });

  it('brings a value back when the definition is restored', () => {
    const turns = stored('tension', 11);
    const relaxed = definition('scene', { ...scene.keys, tension: { type: 'number', min: 0, max: 20 } });
    expect(valueAt(foldTurns(turns), 'tension')).toBe(3);
    expect(valueAt(foldTurns(turns, { defs: [relaxed] }), 'tension')).toBe(11);
    expect(warnings(foldTurns(turns, { defs: [relaxed] }))).toEqual([]);
  });

  it('reads a key whose type changed by the new type’s rules', () => {
    const asText = definition('scene', { tension: { type: 'text', default: 'low' } });
    const story = foldTurns(stored('tension', 5), { defs: [asText] });
    expect(valueAt(story, 'tension')).toBe('low');
    expect(warnings(story)).toHaveLength(1);
    const flipped = definition('scene', { tension: { type: 'number', default: 1 } });
    expect(valueAt(foldTurns(stored('tension', 'x'), { defs: [flipped] }), 'tension')).toBe(1);
  });

  it('ignores scalar writes on a key that became a collection, and brings them back with the type', () => {
    const asList = definition('scene', { tension: { type: 'collection' } });
    const story = foldTurns(stored('tension', 5), { defs: [asList] });
    expect(valueAt(story, 'tension')).toEqual([]);
    expect(story.definitions[0]!.warnings).toEqual([
      { definition: 'scene', key: 'tension', message: '1 stored write was made for another key type and is ignored' },
    ]);
    expect(keyOf(story, 'tension').meta).toMatchObject({ written: false });
    expect(valueAt(foldTurns(stored('tension', 5)), 'tension')).toBe(5);
  });

  it('ignores collection writes on a key that became a scalar', () => {
    const asNumber = definition('scene', { log: { type: 'number', default: 2 } });
    const turns = [turnEntry('a', [addWrite('log', item('1')), addWrite('log', item('2'))])];
    const story = foldTurns(turns, { defs: [asNumber] });
    expect(valueAt(story, 'log')).toBe(2);
    expect(story.definitions[0]!.warnings[0]?.message).toBe(
      '2 stored writes were made for another key type and are ignored',
    );
  });

  it('lets a delete suit every key type', () => {
    const asNumber = definition('scene', { log: { type: 'number', default: 2 } });
    const turns = [turnEntry('a', [addWrite('log', item('1'))]), turnEntry('b', [deleteWrite('log')])];
    const story = foldTurns(turns, { defs: [asNumber] });
    expect(keyOf(story, 'log').meta).toMatchObject({ written: true, writtenAtTurn: 2 });
    expect(valueAt(story, 'log')).toBe(2);
  });

  it('reports writes for a key the definition no longer has, and ignores them', () => {
    const slim = definition('scene', { armed: { type: 'boolean' } });
    const story = foldTurns([turnEntry('a', [setWrite('tension', 5), setWrite('tension', 6), setWrite('gone', 1)])], {
      defs: [slim],
    });
    expect(Object.keys(story.definitions[0]!.keys)).toEqual(['armed']);
    expect(story.definitions[0]!.warnings).toEqual([
      { definition: 'scene', key: 'gone', message: 'The definition no longer has this key; 1 stored write is ignored' },
      {
        definition: 'scene',
        key: 'tension',
        message: 'The definition no longer has this key; 2 stored writes are ignored',
      },
    ]);
  });

  it('ignores writes for an unknown definition silently', () => {
    const story = foldTurns([turnEntry('a', [setWrite('tension', 5, OTHER_DEF)])]);
    expect(story.definitions[0]!.warnings).toEqual([]);
    expect(valueAt(story, 'tension')).toBe(3);
    expect(story.nodes).toEqual([]);
  });

  it('reports a problem per key', () => {
    const story = foldTurns([turnEntry('a', [setWrite('tension', 50), setWrite('mood', 'no')])]);
    expect(warnings(story).map((warning) => warning.key)).toEqual(['tension', 'mood']);
  });

  it('never rewrites the stored data', () => {
    const state = { turns: [turnEntry('a', [setWrite('tension', 50), addWrite('gone', item('x'))])] };
    const before = structuredClone(state);
    foldStoryState({
      definitions: [definition('scene', { tension: { type: 'number', max: 5 } })],
      messages: [reply('a')],
      state,
    });
    expect(state).toEqual(before);
  });
});

describe('history', () => {
  const tension = (turnId: string, n: number) => turnEntry(turnId, [setWrite('tension', n)]);

  it('has one point per turn that wrote the key, with the value after that turn', () => {
    const story = foldTurns([
      tension('a', 5),
      turnEntry('b'),
      turnEntry('c', [setWrite('tension', 6), setWrite('tension', 7)]),
    ]);
    expect(keyOf(story, 'tension').history).toEqual([
      { turn: 1, value: 5 },
      { turn: 3, value: 7 },
    ]);
  });

  it('numbers points by the present turns', () => {
    const story = foldTurns([tension('a', 5), tension('b', 6), tension('c', 7)], { gone: ['a'] });
    expect(keyOf(story, 'tension').history).toEqual([
      { turn: 1, value: 6 },
      { turn: 2, value: 7 },
    ]);
  });

  it('drops the points of a deleted turn', () => {
    const story = foldTurns([tension('a', 5), tension('b', 6)], { gone: ['b'] });
    expect(keyOf(story, 'tension').history).toEqual([{ turn: 1, value: 5 }]);
  });

  it('uses the effective value: the default for a delete and for a value that does not fit', () => {
    const story = foldTurns([tension('a', 5), turnEntry('b', [deleteWrite('tension')]), tension('c', 99)]);
    expect(keyOf(story, 'tension').history.map((point) => point.value)).toEqual([5, 3, 3]);
  });

  it('records the kept item count for a collection', () => {
    const story = foldTurns([
      turnEntry('a', [addWrite('log', item('1')), addWrite('log', item('2'))]),
      turnEntry('b', [addWrite('log', item('3')), addWrite('log', item('4'))]),
      turnEntry('c', [removeWrite('log', '4')]),
    ]);
    // The cap is 3, so the second turn leaves three items.
    expect(keyOf(story, 'log').history).toEqual([
      { turn: 1, value: 2 },
      { turn: 2, value: 3 },
      { turn: 3, value: 3 },
    ]);
  });

  it('keeps the newest 100 points', () => {
    const turns = Array.from({ length: 130 }, (_, i) => tension(`t${i}`, i % 11));
    const history = keyOf(foldTurns(turns), 'tension').history;
    expect(history).toHaveLength(100);
    expect(history[0]!.turn).toBe(31);
    expect(history.at(-1)!.turn).toBe(130);
  });

  it('is empty for a key that was never written', () => {
    expect(keyOf(foldTurns([tension('a', 5)]), 'mood').history).toEqual([]);
  });
});
