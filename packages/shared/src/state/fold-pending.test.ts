import { describe, expect, it } from 'vitest';
import { foldStoryState } from './fold.js';
import {
  addWrite,
  deleteWrite,
  idsOf,
  item,
  keyOf,
  nodeAddWrite,
  nodeSetWrite,
  removeWrite,
  reply,
  scene,
  setWrite,
  turnEntry,
  valueAt,
} from './test-fixtures.js';
import type { StateWrite, TurnEntry } from './writes.js';

// `FoldInput.pending`: the running turn's writes that are not stored yet, folded last, as part of the running turn.

const scoped = (write: StateWrite, workflowId: string): StateWrite =>
  ({ ...write, target: { ...write.target, workflowId } }) as StateWrite;

const stored: TurnEntry[] = [
  turnEntry('a', [setWrite('tension', 4), addWrite('log', item('i1'))]),
  turnEntry('b', [setWrite('tension', 6), addWrite('log', item('i2'))]),
];
const repliedTo = (...ids: string[]) => ids.map((id) => reply(id, 'final'));
const fold = (over: Partial<Parameters<typeof foldStoryState>[0]>) =>
  foldStoryState({ definitions: [scene], messages: repliedTo('a', 'b'), state: { turns: stored }, ...over });

describe('pending writes of a run before its turn has an entry (a first run)', () => {
  const pending = [setWrite('tension', 8), setWrite('mood', 'tense'), addWrite('log', item('p1'))];

  it('with no pending writes folds exactly as without the option', () => {
    expect(fold({ pending: [] })).toEqual(fold({}));
  });

  it('applies them after everything stored and keeps the turn the run reads', () => {
    const story = fold({ pending });
    expect(story.turn).toBe(3);
    expect(valueAt(story, 'tension')).toBe(8);
    expect(valueAt(story, 'mood')).toBe('tense');
    expect(idsOf(story, 'log')).toEqual(['p1', 'i2', 'i1']);
  });

  it('counts them as written in the running turn', () => {
    const story = fold({ pending });
    expect(keyOf(story, 'tension').meta).toMatchObject({ written: true, writtenAtTurn: 3, turnsSinceWrite: 0 });
    expect(keyOf(story, 'tension').history).toEqual([
      { turn: 1, value: 4 },
      { turn: 2, value: 6 },
      { turn: 3, value: 8 },
    ]);
    expect(keyOf(story, 'log').itemTurns).toEqual([3, 2, 1]);
  });

  it('leaves the stored turns alone: they are not given an extra turn', () => {
    const story = fold({ pending });
    expect(story.turns).toEqual(fold({}).turns);
    expect(story.turns).toHaveLength(2);
  });

  it('lets a pending write remove a stored item or reset a key', () => {
    const story = fold({ pending: [removeWrite('log', 'i1'), deleteWrite('tension')] });
    expect(idsOf(story, 'log')).toEqual(['i2']);
    expect(valueAt(story, 'tension')).toBe(3);
    expect(keyOf(story, 'tension').meta.writtenAtTurn).toBe(3);
  });

  it('reads a chat with no stored turns as turn 1', () => {
    const story = foldStoryState({ definitions: [scene], messages: [], state: undefined, pending });
    expect(story.turn).toBe(1);
    expect(valueAt(story, 'tension')).toBe(8);
    expect(keyOf(story, 'log').itemTurns).toEqual([1]);
  });
});

describe('pending writes of a later run of the turn (including)', () => {
  const pending = [setWrite('tension', 9), addWrite('log', item('p1'))];

  it('with no pending writes folds exactly as without the option', () => {
    expect(fold({ including: 'b', pending: [] })).toEqual(fold({ including: 'b' }));
  });

  it('lands after the turn’s stored writes and at the turn’s own number', () => {
    const story = fold({ including: 'b', pending });
    expect(story.turn).toBe(2);
    expect(valueAt(story, 'tension')).toBe(9);
    expect(idsOf(story, 'log')).toEqual(['p1', 'i2', 'i1']);
    expect(keyOf(story, 'tension').meta).toMatchObject({ writtenAtTurn: 2, turnsSinceWrite: 0 });
    // One history point per turn: the pending write replaces the turn’s earlier one.
    expect(keyOf(story, 'tension').history).toEqual([
      { turn: 1, value: 4 },
      { turn: 2, value: 9 },
    ]);
    expect(keyOf(story, 'log').itemTurns).toEqual([2, 2, 1]);
  });

  it('counts the turn as present even when it has no reply yet', () => {
    const story = fold({ messages: repliedTo('a'), including: 'b', pending });
    expect(story.turn).toBe(2);
    expect(valueAt(story, 'tension')).toBe(9);
    expect(idsOf(story, 'log')).toEqual(['p1', 'i2', 'i1']);
  });
});

describe('pending writes of a regenerate', () => {
  // The last turn’s replies are left out of the chat (`withoutLastTurnReplies`), so its entry is not present.
  const messages = repliedTo('a');
  const pending = [setWrite('tension', 7), addWrite('log', item('p1'))];

  it('first run: the new turn takes the place of the replaced one and ignores its writes', () => {
    const story = fold({ messages, pending });
    expect(story.turn).toBe(2);
    expect(valueAt(story, 'tension')).toBe(7);
    expect(idsOf(story, 'log')).toEqual(['p1', 'i1']);
    expect(keyOf(story, 'tension').meta).toMatchObject({ writtenAtTurn: 2, turnsSinceWrite: 0 });
  });

  it('later run: its own entry is the turn, pending writes follow what it stored', () => {
    const state = { turns: [...stored, turnEntry('c', [setWrite('tension', 5)], { replies: 1 })] };
    const story = fold({ messages, state, including: 'c', pending });
    expect(story.turn).toBe(2);
    expect(valueAt(story, 'tension')).toBe(7);
    expect(idsOf(story, 'log')).toEqual(['p1', 'i1']);
    expect(keyOf(story, 'tension').history).toEqual([
      { turn: 1, value: 4 },
      { turn: 2, value: 7 },
    ]);
  });
});

describe('pending writes of a node’s own state', () => {
  const state = { turns: [turnEntry('a', [scoped(nodeAddWrite('draw', 'draws', item('a1')), 'A')])] };
  const pending = [
    scoped(nodeAddWrite('draw', 'draws', item('a2')), 'A'),
    scoped(nodeSetWrite('other', 'flag', true), 'B'),
  ];
  const nodeKeys = (story: ReturnType<typeof fold>, nodeId: string, key: string, workflowId?: string) =>
    story.nodes.find((node) => node.nodeId === nodeId && node.workflowId === workflowId)?.keys[key]?.value;

  it('are read by the workflow that wrote them, merged with its stored ones', () => {
    const story = fold({ messages: repliedTo('a'), state, workflowId: 'A', pending });
    expect((nodeKeys(story, 'draw', 'draws') as { id: string }[]).map((entry) => entry.id)).toEqual(['a2', 'a1']);
  });

  it('stay out of another workflow’s scoped fold', () => {
    const story = fold({ messages: repliedTo('a'), state, workflowId: 'C', pending });
    expect(story.nodes).toEqual([]);
  });

  it('are listed under their workflow in an unscoped fold', () => {
    const story = fold({ messages: repliedTo('a'), state, pending });
    expect(story.nodes.map((node) => [node.nodeId, node.workflowId])).toEqual([
      ['draw', 'A'],
      ['other', 'B'],
    ]);
    expect(nodeKeys(story, 'other', 'flag', 'B')).toBe(true);
  });
});
