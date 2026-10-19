import { describe, expect, it } from 'vitest';
import { foldStoryState } from './fold.js';
import { stateSnapshot } from './snapshot.js';
import { addWrite, item, nodeAddWrite, reply, scene, setWrite, turnEntry } from './test-fixtures.js';
import type { StateWrite, TurnEntry } from './writes.js';

// A node's own state belongs to its workflow: node ids repeat across the workflows of a chat.

const scoped = (write: StateWrite, workflowId: string): StateWrite =>
  ({ ...write, target: { ...write.target, workflowId } }) as StateWrite;
const draws = (workflowId: string | undefined, id: string): StateWrite =>
  workflowId ? scoped(nodeAddWrite('draw', 'draws', item(id)), workflowId) : nodeAddWrite('draw', 'draws', item(id));

const turns: TurnEntry[] = [
  turnEntry('t1', [draws(undefined, 'legacy')]),
  turnEntry('t2', [draws('A', 'a1'), draws('B', 'b1')]),
  turnEntry('t3', [draws('A', 'a2')]),
];
const messages = turns.map((entry) => reply(entry.executionId, 'final'));
const fold = (workflowId?: string) => foldStoryState({ definitions: [scene], messages, state: { turns }, workflowId });
const ids = (story: ReturnType<typeof fold>, workflowId?: string) =>
  (
    story.nodes.find((node) => node.nodeId === 'draw' && node.workflowId === workflowId)?.keys.draws?.value as
      | { id: string }[]
      | undefined
  )?.map((entry) => entry.id);

describe('node-private state scoped by workflow', () => {
  it('reads the workflow’s own writes and the legacy ones, merged in stored order', () => {
    const story = fold('A');
    expect(story.nodes).toHaveLength(1);
    expect(story.nodes[0]).not.toHaveProperty('workflowId');
    expect(ids(story)).toEqual(['a2', 'a1', 'legacy']);
  });

  it('keeps another workflow’s writes out, whatever the node ids', () => {
    expect(ids(fold('B'))).toEqual(['b1', 'legacy']);
  });

  it('gives a workflow that never wrote only the legacy writes', () => {
    expect(ids(fold('C'))).toEqual(['legacy']);
  });

  it('reads a chat without workflow ids exactly as before, for any workflow', () => {
    const legacyOnly = [turnEntry('t1', [draws(undefined, 'x')]), turnEntry('t2', [draws(undefined, 'y')])];
    const story = foldStoryState({
      definitions: [scene],
      messages: legacyOnly.map((entry) => reply(entry.executionId, 'final')),
      state: { turns: legacyOnly },
      workflowId: 'anything',
    });
    expect(ids(story)).toEqual(['y', 'x']);
  });

  it('without a scope lists each workflow’s nodes apart, the legacy ones without a workflow id', () => {
    const story = fold();
    expect(story.nodes.map((node) => [node.nodeId, node.workflowId])).toEqual([
      ['draw', undefined],
      ['draw', 'A'],
      ['draw', 'B'],
    ]);
    expect(ids(story, undefined)).toEqual(['legacy']);
    expect(ids(story, 'A')).toEqual(['a2', 'a1']);
    expect(ids(story, 'B')).toEqual(['b1']);
  });

  it('shares definition keys across workflows either way', () => {
    const shared = [turnEntry('t1', [setWrite('tension', 7)])];
    const read = (workflowId?: string) =>
      foldStoryState({
        definitions: [scene],
        messages: [reply('t1', 'final')],
        state: { turns: shared },
        workflowId,
      }).definitions[0]!.keys.tension!.value;
    expect([read('A'), read('B'), read()]).toEqual([7, 7, 7]);
  });

  it('puts only what a run of the workflow reads into its snapshot', () => {
    const snapshot = (workflowId?: string) => {
      const story = fold(workflowId);
      return stateSnapshot(story, [scene]).nodes;
    };
    expect(Object.keys(snapshot('A'))).toEqual(['draw']);
    expect((snapshot('A').draw!.draws!.value as unknown[]).length).toBe(3);
    // An unscoped fold has the workflows apart: a snapshot takes only the legacy entry.
    expect((snapshot().draw!.draws!.value as unknown[]).length).toBe(1);
  });

  it('drops the writes of a turn that is not present, as for any key', () => {
    const story = foldStoryState({
      definitions: [scene],
      messages: [reply('t1', 'final'), reply('t3', 'final')],
      state: { turns },
      workflowId: 'B',
    });
    expect(ids(story)).toEqual(['legacy']);
  });

  it('is unaffected by a stray workflow id on a definition write', () => {
    const odd = [turnEntry('t1', [{ ...addWrite('log', item('i1')), workflowId: 'A' } as StateWrite])];
    const story = foldStoryState({
      definitions: [scene],
      messages: [reply('t1', 'final')],
      state: { turns: odd },
      workflowId: 'B',
    });
    expect(story.definitions[0]!.keys.log!.meta.count).toBe(1);
  });
});

describe('foldStoryState including', () => {
  const entries = [
    turnEntry('t1', [setWrite('tension', 4)]),
    turnEntry('t2', [setWrite('mood', 'tense')], { replies: 0, completed: false }),
  ];
  const only = [reply('t1', 'final')];
  const read = (including?: string) =>
    foldStoryState({ definitions: [scene], messages: only, state: { turns: entries }, including });

  it('counts the turn being run as present whatever its replies, so later runs see its writes', () => {
    expect(read().definitions[0]!.keys.mood!.value).toBe('calm');
    const story = read('t2');
    expect(story.definitions[0]!.keys.mood!.value).toBe('tense');
    expect(story.turns.map(({ turn }) => turn)).toEqual([1, 2]);
  });

  it('reads as of that turn: its number is the turn being run, the same for every run of it', () => {
    expect(read().turn).toBe(2);
    expect(read('t2').turn).toBe(2);
    expect(read('t2').definitions[0]!.keys.mood!.meta.turnsSinceWrite).toBe(0);
  });

  it('lets an explicit turn win, and ignores an id that is not an entry', () => {
    expect(
      foldStoryState({ definitions: [scene], messages: only, state: { turns: entries }, including: 't2', turn: 5 })
        .turn,
    ).toBe(5);
    expect(read('nope').turn).toBe(2);
  });
});
