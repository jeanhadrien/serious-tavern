import { describe, expect, it } from 'vitest';
import { foldStoryState } from './fold.js';
import {
  duplicateNameIssues,
  emptyStateSnapshot,
  oldestFirst,
  stateHints,
  stateSnapshot,
  stateTemplateValues,
} from './snapshot.js';
import { chat, linkTo, range, withEdit } from '../links/test-fixtures.js';
import { addWrite, DEF, definition, item, nodeAddWrite, reply, setWrite, turnEntry } from './test-fixtures.js';

const OTHER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

const scene = definition('scene', {
  tension: { type: 'number', default: 3, min: 0, max: 10 },
  mood: { type: 'enum', options: ['calm', 'tense'] },
  log: { type: 'collection', cap: 2 },
});

function snapshotAfter(
  turns = [
    turnEntry('a', [
      setWrite('tension', 7),
      addWrite('log', item('1')),
      addWrite('log', item('2')),
      addWrite('log', item('3')),
    ]),
  ],
) {
  const story = foldStoryState({
    definitions: [scene],
    messages: turns.map((t) => reply(t.executionId)),
    state: { turns },
  });
  return { story, snapshot: stateSnapshot(story, [scene]) };
}

describe('stateSnapshot', () => {
  it('carries the turn, values, meta and item turns, by definition id', () => {
    const { snapshot } = snapshotAfter();
    expect(snapshot.turn).toBe(2);
    expect(snapshot.keys[DEF]!.tension).toEqual({
      value: 7,
      meta: { written: true, turnsSinceWrite: 1, writtenAtTurn: 1 },
    });
    expect(snapshot.keys[DEF]!.mood).toMatchObject({ value: 'calm', meta: { written: false, turnsSinceWrite: 2 } });
    expect(snapshot.keys[DEF]!.log).toMatchObject({
      value: [
        { id: '3', text: '3' },
        { id: '2', text: '2' },
      ],
      meta: { count: 2, droppedByCap: 1 },
      itemTurns: [1, 1],
    });
  });

  it('lists the ids of the present turns, oldest first', () => {
    const entries = [turnEntry('a', []), turnEntry('b', []), turnEntry('c', [])];
    // 'b' lost its replies; 'c' is the turn being run, counted only when the fold is given it.
    const turnIds = (including?: string) =>
      stateSnapshot(
        foldStoryState({
          definitions: [scene],
          messages: [reply('a'), reply('c')],
          state: { turns: entries },
          including,
        }),
        [scene],
      ).turnIds;
    expect(turnIds()).toEqual(['a', 'c']);
    expect(turnIds('b')).toEqual(['a', 'b', 'c']);
    expect(emptyStateSnapshot([scene]).turnIds).toEqual([]);
  });

  it('has no history and no warnings', () => {
    const { snapshot } = snapshotAfter();
    expect(JSON.stringify(snapshot)).not.toContain('history');
    expect(JSON.stringify(snapshot)).not.toContain('warnings');
    expect(snapshot.keys[DEF]!.tension).not.toHaveProperty('history');
    expect(snapshot.keys[DEF]!.tension).not.toHaveProperty('itemTurns');
  });

  it('copies the definitions so a run cannot change the record it came from', () => {
    const { snapshot } = snapshotAfter();
    expect(snapshot.definitions).toEqual([scene]);
    expect(snapshot.definitions[0]).not.toBe(scene);
    (snapshot.definitions[0]!.keys.tension as { max: number }).max = 99;
    expect((scene.keys.tension as { max: number }).max).toBe(10);
  });

  it('carries node implicit keys by node id', () => {
    const { snapshot } = snapshotAfter([turnEntry('a', [nodeAddWrite('draw-1', 'draws', item('x'))])]);
    expect(snapshot.nodes['draw-1']!.draws).toMatchObject({ value: [{ id: 'x' }], itemTurns: [1] });
    expect(snapshot.nodes.nobody).toBeUndefined();
  });

  it('is safe for node ids that look like object internals', () => {
    const { snapshot } = snapshotAfter([turnEntry('a', [nodeAddWrite('__proto__', 'draws', item('x'))])]);
    expect(Object.getPrototypeOf(snapshot.nodes)).toBe(Object.prototype);
    expect(Object.hasOwn(snapshot.nodes, '__proto__')).toBe(true);
  });
});

describe('stateSnapshot: message links', () => {
  const memory = definition('memory', { summaries: { type: 'collection' }, plain: { type: 'collection' } });
  const history = chat(40);
  const linked = (id: string, ids: string[], messages = history) =>
    item(id, `summary ${id}`, { messages: linkTo(messages, ids) });
  const turns = [
    turnEntry('a', [
      addWrite('summaries', linked('s1', range(1, 20))),
      addWrite('plain', item('p1')),
      nodeAddWrite('draw-1', 'facts', linked('f1', range(21, 22))),
    ]),
    turnEntry('b', [addWrite('summaries', linked('s2', range(21, 40)))]),
  ];
  const snapshotWith = (messages?: ReturnType<typeof chat>) => {
    const story = foldStoryState({
      definitions: [memory],
      messages: turns.map((turn) => reply(turn.executionId)),
      state: { turns },
    });
    return stateSnapshot(story, [memory], messages);
  };
  const items = (snapshot: ReturnType<typeof snapshotWith>, key = 'summaries') =>
    snapshot.keys[DEF]![key]!.value as { id: string; link?: unknown }[];

  it('adds the computed link to linked items: status, stored ids and the first position', () => {
    expect(items(snapshotWith(history)).map(({ id, link }) => [id, link])).toEqual([
      ['s2', { status: 'intact', ids: range(21, 40), first: 21 }],
      ['s1', { status: 'intact', ids: range(1, 20), first: 1 }],
    ]);
  });

  it('follows the history it is given: an edited message changes the status, a deleted one the position', () => {
    const edited = items(snapshotWith(withEdit(history, 'm5', 'edited')));
    expect(edited.map(({ id, link }) => [id, (link as { status: string }).status])).toEqual([
      ['s2', 'intact'],
      ['s1', 'changed'],
    ]);
    const shifted = items(snapshotWith(withEdit(history, 'm1')));
    expect(shifted[1]!.link).toEqual({ status: 'partial', ids: range(1, 20), first: 1 });
    expect(shifted[0]!.link).toEqual({ status: 'intact', ids: range(21, 40), first: 20 });
  });

  it('reports a gone item without a position', () => {
    expect(items(snapshotWith(history.slice(20)))[1]!.link).toEqual({ status: 'gone', ids: range(1, 20) });
  });

  it('leaves items without a link alone, and adds nothing without a history', () => {
    expect(items(snapshotWith(history), 'plain')).toEqual([{ id: 'p1', text: 'p1' }]);
    for (const entry of items(snapshotWith())) expect(entry).not.toHaveProperty('link');
  });

  it('does the same for the implicit collections of nodes', () => {
    const snapshot = snapshotWith(history);
    expect(snapshot.nodes['draw-1']!.facts!.value).toMatchObject([
      { id: 'f1', link: { status: 'intact', ids: range(21, 22), first: 21 } },
    ]);
  });

  it('never changes the folded story it was made from', () => {
    const story = foldStoryState({
      definitions: [memory],
      messages: turns.map((turn) => reply(turn.executionId)),
      state: { turns },
    });
    stateSnapshot(story, [memory], history);
    expect(JSON.stringify(story.definitions[0]!.keys.summaries!.value)).not.toContain('"link"');
  });

  it('shows up in template values, so the linked helper can read it', () => {
    const values = stateTemplateValues(snapshotWith(history));
    expect((values.memory!.summaries as { link: { status: string } }[]).map((entry) => entry.link.status)).toEqual([
      'intact',
      'intact',
    ]);
  });
});

describe('emptyStateSnapshot', () => {
  it('is turn 1 with every key at its default', () => {
    const snapshot = emptyStateSnapshot([scene]);
    expect(snapshot.turn).toBe(1);
    expect(snapshot.keys[DEF]!.tension).toEqual({
      value: 3,
      meta: { written: false, turnsSinceWrite: 1, writtenAtTurn: null },
    });
    expect(snapshot.keys[DEF]!.log).toMatchObject({ value: [], meta: { count: 0, droppedByCap: 0 }, itemTurns: [] });
    expect(snapshot.nodes).toEqual({});
  });

  it('equals the snapshot of a fold over nothing, and works without definitions', () => {
    const fromFold = stateSnapshot(foldStoryState({ definitions: [scene], messages: [], state: undefined }), [scene]);
    expect(emptyStateSnapshot([scene])).toEqual(fromFold);
    expect(emptyStateSnapshot()).toEqual({ turn: 1, turnIds: [], definitions: [], keys: {}, nodes: {} });
  });
});

describe('stateTemplateValues', () => {
  it('is empty without a snapshot', () => {
    expect(stateTemplateValues()).toEqual({});
    expect(stateTemplateValues(emptyStateSnapshot())).toEqual({});
  });

  it('maps definition names to key values, collections as items newest first', () => {
    const { snapshot } = snapshotAfter();
    expect(stateTemplateValues(snapshot)).toEqual({
      scene: {
        tension: 7,
        mood: 'calm',
        log: [
          { id: '3', text: '3' },
          { id: '2', text: '2' },
        ],
      },
    });
  });

  it('lets the oldest definition keep a repeated name', () => {
    const older = definition('scene', { a: { type: 'text', default: 'old' } }, { id: OTHER, createdAt: '2025-01-01' });
    const newer = definition('scene', { a: { type: 'text', default: 'new' } }, { id: THIRD, createdAt: '2026-06-01' });
    for (const order of [
      [older, newer],
      [newer, older],
    ])
      expect(stateTemplateValues(emptyStateSnapshot(order))).toEqual({ scene: { a: 'old' } });
  });

  it('uses the default of a key the snapshot has no view for', () => {
    const snapshot = { ...emptyStateSnapshot([scene]), keys: {} };
    expect(stateTemplateValues(snapshot).scene).toMatchObject({ tension: 3, mood: 'calm', log: [] });
  });

  it('returns values that can be changed without touching the snapshot', () => {
    const { snapshot } = snapshotAfter();
    stateTemplateValues(snapshot).scene!.tension = 0;
    expect(snapshot.keys[DEF]!.tension!.value).toBe(7);
  });
});

describe('oldestFirst', () => {
  it('orders by createdAt, then id, and does not change the input', () => {
    const a = { id: 'b', createdAt: '2026-01-01' };
    const b = { id: 'a', createdAt: '2026-01-01' };
    const c = { id: 'c', createdAt: '2025-01-01' };
    const input = [a, b, c];
    expect(oldestFirst(input)).toEqual([c, b, a]);
    expect(input).toEqual([a, b, c]);
  });
});

describe('duplicateNameIssues', () => {
  const named = (name: string, id: string) => definition(name, {}, { id });
  it('is empty when every name is used once, and case differences are different names', () => {
    expect(duplicateNameIssues([])).toEqual([]);
    expect(duplicateNameIssues([named('scene', DEF), named('Scene', OTHER), named('mood', THIRD)])).toEqual([]);
  });

  it('names each repeated name once, in name order', () => {
    expect(
      duplicateNameIssues([
        named('zeta', DEF),
        named('zeta', OTHER),
        named('alpha', THIRD),
        named('alpha', 'x'),
        named('alpha', 'y'),
      ]),
    ).toEqual([
      'State definition name "alpha" is used 3 times; only the oldest is available to templates.',
      'State definition name "zeta" is used twice; only the oldest is available to templates.',
    ]);
  });
});

describe('stateHints', () => {
  it('lists every key as definition.key with its port type', () => {
    const hints = stateHints([scene]);
    expect(hints.map((hint) => [hint.path, hint.type])).toEqual([
      ['scene.tension', 'number'],
      ['scene.mood', 'text'],
      ['scene.log', 'array'],
    ]);
    expect(hints.map((hint) => hint.description)).toEqual([
      'Story state: Number from 0 to 10',
      'Story state: One of: calm, tense',
      'Story state: List of items, newest first (up to 2)',
    ]);
  });

  it.each([
    [{ type: 'number', min: 1 }, 'Number, at least 1'],
    [{ type: 'number', max: 4 }, 'Number, at most 4'],
    [{ type: 'number' }, 'Number'],
    [{ type: 'boolean' }, 'True or false'],
    [{ type: 'text' }, 'Text'],
    [{ type: 'object' }, 'Object'],
    [{ type: 'collection' }, 'List of items, newest first'],
  ] as const)('describes %j', (def, text) => {
    expect(stateHints([definition('d', { k: def })])[0]?.description).toBe(`Story state: ${text}`);
  });

  it('skips a repeated name (the oldest keeps it) and is empty without definitions', () => {
    expect(stateHints([])).toEqual([]);
    const older = definition('scene', { a: { type: 'text' } }, { id: OTHER, createdAt: '2025-01-01' });
    const newer = definition('scene', { b: { type: 'text' } }, { id: THIRD, createdAt: '2026-06-01' });
    expect(stateHints([newer, older]).map((hint) => hint.path)).toEqual(['scene.a']);
  });
});
