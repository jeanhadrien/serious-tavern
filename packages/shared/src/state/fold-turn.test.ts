import { describe, expect, it } from 'vitest';
import { foldStoryState } from './fold.js';
import { withRunSettled } from './runs.js';
import { addWrite, foldTurns, item, keyOf, reply, scene, setWrite, turnEntry, valueAt } from './test-fixtures.js';
import { readTurnEntries } from './writes.js';

// A run of the after section reads the state as of the turn it belongs to (`including`), not as of the next one.

const turns = [turnEntry('a', [setWrite('tension', 5)]), turnEntry('b', [setWrite('mood', 'tense')])];
const messages = turns.map((entry) => reply(entry.executionId, 'final'));
const fold = (including?: string, state: unknown = { turns }) =>
  foldStoryState({ definitions: [scene], messages, state, ...(including === undefined ? {} : { including }) });

describe('foldStoryState turn', () => {
  it('reads the next turn when none is given', () => {
    expect(fold().turn).toBe(3);
  });

  it('reads at the turn it includes', () => {
    expect(fold('b').turn).toBe(2);
    expect(fold('b').turns.map(({ turn }) => turn)).toEqual([1, 2]);
  });

  it('gives a key written at the turn read at turnsSinceWrite 0 and others the distance to it', () => {
    const story = fold('b');
    expect(keyOf(story, 'mood').meta).toMatchObject({ written: true, writtenAtTurn: 2, turnsSinceWrite: 0 });
    expect(keyOf(story, 'tension').meta).toMatchObject({ written: true, writtenAtTurn: 1, turnsSinceWrite: 1 });
  });

  it('keeps the next-turn reading one turn further on', () => {
    const story = fold();
    expect(keyOf(story, 'mood').meta.turnsSinceWrite).toBe(1);
    expect(keyOf(story, 'tension').meta.turnsSinceWrite).toBe(2);
  });

  it('counts a key nobody wrote from before turn 1: turnsSinceWrite equals the turn read at', () => {
    expect(keyOf(fold('b'), 'note').meta).toEqual({ written: false, turnsSinceWrite: 2, writtenAtTurn: null });
  });

  it('changes neither the values nor the item turns of a collection', () => {
    const state = {
      turns: [turnEntry('a', [addWrite('log', item('i1'))]), turnEntry('b', [addWrite('log', item('i2'))])],
    };
    const next = fold(undefined, state);
    const at = fold('b', state);
    expect(valueAt(at, 'log')).toEqual(valueAt(next, 'log'));
    expect(keyOf(at, 'log').itemTurns).toEqual([2, 1]);
    expect(keyOf(at, 'log').meta).toMatchObject({ count: 2, turnsSinceWrite: 0 });
  });
});

describe('a run of the after section: its writes in the fold', () => {
  const settled = [
    turnEntry('a', [setWrite('tension', 4)], {
      runs: [{ executionId: 'p', workflowId: 'w', part: 'post', status: 'running' }],
    }),
  ];
  const withPost = withRunSettled({ turns: settled }, 'a', {
    run: { executionId: 'p', workflowId: 'w', part: 'post', status: 'completed' },
    writes: [setWrite('tension', 5), setWrite('note', 'after')],
  });

  it('is the last write of the key, at the turn it follows', () => {
    const story = foldStoryState({
      definitions: [scene],
      messages: [reply('a', 'final')],
      state: withPost,
      including: 'a',
    });
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
    const state = withRunSettled(
      { turns: [turnEntry('a', [setWrite('tension', 4)]), turnEntry('b', [setWrite('tension', 6)])] },
      'b',
      {
        run: { executionId: 'p', workflowId: 'w', part: 'post', status: 'completed' },
        writes: [setWrite('tension', 7)],
      },
    );
    expect(valueAt(foldTurns(readTurnEntries(state)), 'tension')).toBe(7);
    expect(valueAt(foldTurns(readTurnEntries(state), { gone: ['b'] }), 'tension')).toBe(4);
  });
});

describe('foldStoryState visibleRuns', () => {
  // The turn being run holds the writes of three runs; a run reads only the ones it waited for.
  const tagged = (runId: string, ...writes: ReturnType<typeof setWrite>[]) =>
    writes.map((write) => ({ ...write, runId }));
  const state = {
    turns: [
      turnEntry('a', [setWrite('tension', 5)]),
      turnEntry(
        't',
        [...tagged('r1', setWrite('tension', 7)), ...tagged('r2', setWrite('mood', 'tense'), setWrite('tension', 9))],
        {
          replies: 0,
        },
      ),
    ],
  };
  const read = (visibleRuns?: string[]) =>
    foldStoryState({
      definitions: [scene],
      messages: [reply('a', 'final')],
      state,
      including: 't',
      ...(visibleRuns && { visibleRuns: new Set(visibleRuns) }),
    });

  it('counts only the writes of the visible runs of the turn being run, later ones winning', () => {
    expect(valueAt(read(['r1']), 'tension')).toBe(7);
    expect(valueAt(read(['r1']), 'mood')).toBe('calm');
    expect(valueAt(read(['r1', 'r2']), 'tension')).toBe(9);
    expect(valueAt(read(['r2']), 'mood')).toBe('tense');
  });

  it("shows none of the turn's writes to a run that waited for nothing, and every one when no runs are named", () => {
    expect(valueAt(read([]), 'tension')).toBe(5);
    expect(valueAt(read(), 'tension')).toBe(9);
  });

  it('never hides a write without a run tag, or the writes of other turns', () => {
    const legacy = { turns: [turnEntry('t', [setWrite('tension', 8)], { replies: 0 })] };
    const story = foldStoryState({
      definitions: [scene],
      messages: [],
      state: legacy,
      including: 't',
      visibleRuns: new Set(),
    });
    expect(valueAt(story, 'tension')).toBe(8);
    expect(valueAt(read([]), 'tension')).toBe(5);
  });
});
