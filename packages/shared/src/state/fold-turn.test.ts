import { describe, expect, it } from 'vitest';
import { foldStoryState } from './fold.js';
import { withPostRun } from './post-run.js';
import { addWrite, foldTurns, item, keyOf, reply, scene, setWrite, turnEntry, valueAt } from './test-fixtures.js';
import { readTurnEntries } from './writes.js';

// A post-turn run reads the state as of the turn it follows (`turn`), not as of the next one.

const turns = [turnEntry('a', [setWrite('tension', 5)]), turnEntry('b', [setWrite('mood', 'tense')])];
const messages = turns.map((entry) => reply(entry.executionId, 'final'));
const fold = (turn?: number, state: unknown = { turns }) =>
  foldStoryState({ definitions: [scene], messages, state, ...(turn === undefined ? {} : { turn }) });

describe('foldStoryState turn', () => {
  it('reads the next turn when none is given', () => {
    expect(fold().turn).toBe(3);
    expect(fold(undefined).turn).toBe(3);
  });

  it('reads at the turn it is given', () => {
    expect(fold(2).turn).toBe(2);
    expect(fold(2).turns.map(({ turn }) => turn)).toEqual([1, 2]);
  });

  it('gives a key written at the turn read at turnsSinceWrite 0 and others the distance to it', () => {
    const story = fold(2);
    expect(keyOf(story, 'mood').meta).toMatchObject({ written: true, writtenAtTurn: 2, turnsSinceWrite: 0 });
    expect(keyOf(story, 'tension').meta).toMatchObject({ written: true, writtenAtTurn: 1, turnsSinceWrite: 1 });
  });

  it('keeps the next-turn reading one turn further on', () => {
    const story = fold();
    expect(keyOf(story, 'mood').meta.turnsSinceWrite).toBe(1);
    expect(keyOf(story, 'tension').meta.turnsSinceWrite).toBe(2);
  });

  it('counts a key nobody wrote from before turn 1: turnsSinceWrite equals the turn read at', () => {
    expect(keyOf(fold(2), 'note').meta).toEqual({ written: false, turnsSinceWrite: 2, writtenAtTurn: null });
  });

  it('changes neither the values nor the item turns of a collection', () => {
    const state = {
      turns: [turnEntry('a', [addWrite('log', item('i1'))]), turnEntry('b', [addWrite('log', item('i2'))])],
    };
    const next = fold(undefined, state);
    const at = fold(2, state);
    expect(valueAt(at, 'log')).toEqual(valueAt(next, 'log'));
    expect(keyOf(at, 'log').itemTurns).toEqual([2, 1]);
    expect(keyOf(at, 'log').meta).toMatchObject({ count: 2, turnsSinceWrite: 0 });
  });

  it('changes neither the numbering of the turns nor which of them count', () => {
    const gone = foldStoryState({ definitions: [scene], messages: [messages[0]!], state: { turns }, turn: 1 });
    expect(gone.turns.map(({ turn }) => turn)).toEqual([1, null]);
    expect(valueAt(gone, 'mood')).toBe('calm');
  });
});

describe('a post run’s writes in the fold', () => {
  const settled = [turnEntry('a', [setWrite('tension', 4)], { postExecutionId: 'p', postStatus: 'running' })];
  const withPost = withPostRun({ turns: settled }, 'a', {
    status: 'completed',
    writes: [setWrite('tension', 5), setWrite('note', 'after')],
  });

  it('is the last write of the key, at the turn it follows', () => {
    const story = foldStoryState({ definitions: [scene], messages: [reply('a', 'final')], state: withPost, turn: 1 });
    expect(valueAt(story, 'tension')).toBe(5);
    expect(valueAt(story, 'note')).toBe('after');
    expect(keyOf(story, 'tension').meta).toMatchObject({ writtenAtTurn: 1, turnsSinceWrite: 0 });
    expect(keyOf(story, 'tension').history).toEqual([{ turn: 1, value: 5 }]);
  });

  it('vanishes together with the turn’s own writes when its replies are deleted', () => {
    const story = foldStoryState({ definitions: [scene], messages: [], state: withPost });
    expect(valueAt(story, 'tension')).toBe(3);
    expect(valueAt(story, 'note')).toBe('none');
    expect(story.turn).toBe(1);
  });

  it('is undone only with its own turn', () => {
    const state = withPostRun(
      { turns: [turnEntry('a', [setWrite('tension', 4)]), turnEntry('b', [setWrite('tension', 6)])] },
      'b',
      { status: 'completed', writes: [setWrite('tension', 7)] },
    );
    expect(valueAt(foldTurns(readTurnEntries(state)), 'tension')).toBe(7);
    expect(valueAt(foldTurns(readTurnEntries(state), { gone: ['b'] }), 'tension')).toBe(4);
  });
});
