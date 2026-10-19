import { describe, expect, it } from 'vitest';
import { activeMessages, alternativesOfLastTurn, type AlternativeMessage } from './alternatives.js';
import { forkCut, forkPoints } from './fork.js';
import { foldStoryState } from './state/fold.js';
import { addWrite, item, nodeAddWrite, scene, setWrite, turnEntry, valueAt } from './state/test-fixtures.js';
import { readTurnEntries } from './state/writes.js';

type Row = AlternativeMessage & { content?: string; note?: unknown };

const user = (id: string, executionId?: string, extra: Partial<Row> = {}): Row => ({
  id,
  role: 'user',
  ...(executionId && { executionId }),
  ...extra,
});
const bot = (id: string, executionId: string | undefined, extra: Partial<Row> = {}): Row => ({
  id,
  role: 'assistant',
  status: 'final',
  ...(executionId && { executionId }),
  ...extra,
});
/** A reply of a regenerated alternative of `root`. */
const alt = (id: string, executionId: string, root: string, extra: Partial<Row> = {}): Row =>
  bot(id, executionId, { alternativeOf: root, ...extra });
const off = { inactive: true } as const;

const ids = (messages: readonly Row[] | undefined) => messages?.map((m) => m.id);
const executionIds = (state: { turns: unknown[] } | undefined) =>
  state?.turns.map((t) => (t as { executionId: string }).executionId);
const cut = (messages: Row[], state: unknown, id: string, keepAlternatives = true) =>
  forkCut(messages, state, id, { keepAlternatives });

/** A chat of three turns, one reply each. */
const linear = [
  user('u1', 't1'),
  bot('a1', 't1'),
  user('u2', 't2'),
  bot('a2', 't2'),
  user('u3', 't3'),
  bot('a3', 't3'),
];
const linearState = { turns: [turnEntry('t1'), turnEntry('t2'), turnEntry('t3')] };

describe('forkPoints', () => {
  it.each<[string, Row[], string[]]>([
    ['no messages', [], []],
    ['only a user message', [user('u1', 't1')], []],
    ['one reply per turn: every reply', linear, ['a1', 'a2', 'a3']],
    [
      'a turn with two replies: only the last',
      [user('u1', 't1'), bot('a1', 't1'), bot('b1', 't1'), user('u2', 't2'), bot('a2', 't2')],
      ['b1', 'a2'],
    ],
    [
      'a turn whose replies are not contiguous: still the last of the turn',
      [user('u1', 't1'), bot('a1', 't1'), bot('x', 't2'), bot('b1', 't1')],
      ['x', 'b1'],
    ],
    [
      'a regenerated turn: the shown alternative only',
      [user('u1', 't1'), bot('a1', 't1', off), alt('a1b', 't1b', 't1')],
      ['a1b'],
    ],
    ['a regenerated turn shown on its root', [user('u1', 't1'), bot('a1', 't1'), alt('a1b', 't1b', 't1', off)], ['a1']],
    ['a reply that is still streaming', [user('u1', 't1'), bot('a1', 't1', { status: 'streaming' })], []],
    ['a partial reply (stopped)', [user('u1', 't1'), bot('a1', 't1', { status: 'partial' })], ['a1']],
    [
      'a reply with no status (non-streaming send)',
      [user('u1', 't1'), { id: 'a1', role: 'assistant', executionId: 't1' }],
      ['a1'],
    ],
    [
      'replies without an execution id (older chats): each is a turn of its own',
      [
        { id: 'u1', role: 'user' },
        { id: 'a1', role: 'assistant' },
        { id: 'u2', role: 'user' },
        { id: 'a2', role: 'assistant' },
      ],
      ['a1', 'a2'],
    ],
  ])('%s', (_, messages, expected) => {
    expect(forkPoints(messages)).toEqual(expected);
  });
});

describe('forkCut', () => {
  it('cuts a linear chat after the second of three replies, the messages unchanged', () => {
    const result = cut(linear, linearState, 'a2');
    expect(ids(result?.messages)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(result?.messages[3]).toBe(linear[3]);
    expect(executionIds(result?.state)).toEqual(['t1', 't2']);
    expect(result?.state.turns[1]).toBe(linearState.turns[1]);
  });

  it('keeps the whole chat when forking at the last reply', () => {
    const result = cut(linear, linearState, 'a3');
    expect(ids(result?.messages)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
    expect(executionIds(result?.state)).toEqual(['t1', 't2', 't3']);
  });

  it('never changes its input', () => {
    const before = JSON.stringify([linear, linearState]);
    cut(linear, linearState, 'a1');
    expect(JSON.stringify([linear, linearState])).toBe(before);
  });

  it('cuts after the last reply of a turn with two replies and keeps both', () => {
    const messages = [user('u1', 't1'), bot('a1', 't1'), bot('b1', 't1'), user('u2', 't2'), bot('a2', 't2')];
    const state = { turns: [turnEntry('t1', [], { replies: 2 }), turnEntry('t2')] };
    const result = cut(messages, state, 'b1');
    expect(ids(result?.messages)).toEqual(['u1', 'a1', 'b1']);
    expect(executionIds(result?.state)).toEqual(['t1']);
    expect(cut(messages, state, 'a1')).toBeUndefined();
  });

  describe('a regenerated turn', () => {
    // t2 was regenerated twice: root t2, then t2b, then t2c (shown). The root's replies sit before the shown ones.
    const regenerated = [
      user('u1', 't1'),
      bot('a1', 't1'),
      user('u2', 't2'),
      bot('a2', 't2', off),
      alt('a2b', 't2b', 't2', off),
      alt('a2c', 't2c', 't2'),
      user('u3', 't3'),
      bot('a3', 't3'),
    ];
    const state = { turns: ['t1', 't2', 't2b', 't2c', 't3'].map((id) => turnEntry(id)) };

    it('keeps the alternatives by default, so the fork can swipe the turn', () => {
      const result = cut(regenerated, state, 'a2c');
      expect(ids(result?.messages)).toEqual(['u1', 'a1', 'u2', 'a2', 'a2b', 'a2c']);
      const found = alternativesOfLastTurn(result!.messages);
      expect(found?.alternatives.map((a) => a.executionId)).toEqual(['t2', 't2b', 't2c']);
      expect(found?.activeExecutionId).toBe('t2c');
      expect(executionIds(result?.state)).toEqual(['t1', 't2', 't2b', 't2c']);
    });

    it('keeps no alternative with keepAlternatives: false', () => {
      const result = cut(regenerated, state, 'a2c', false);
      expect(ids(result?.messages)).toEqual(['u1', 'a1', 'u2', 'a2c']);
      expect(alternativesOfLastTurn(result!.messages)?.alternatives).toHaveLength(1);
      // The entries of the dropped alternatives stay (no reply: they never count); only later turns go.
      expect(executionIds(result?.state)).toEqual(['t1', 't2', 't2b', 't2c']);
    });

    it('is not a fork point on a hidden alternative', () => {
      expect(cut(regenerated, state, 'a2')).toBeUndefined();
      expect(cut(regenerated, state, 'a2b')).toBeUndefined();
    });

    it('cuts at the root when it is the shown alternative, keeping the hidden ones after it', () => {
      const shownRoot = [
        user('u1', 't1'),
        bot('a1', 't1'),
        alt('a1b', 't1b', 't1', off),
        user('u2', 't2'),
        bot('a2', 't2'),
      ];
      const entries = { turns: [turnEntry('t1'), turnEntry('t1b'), turnEntry('t2')] };
      const result = cut(shownRoot, entries, 'a1');
      expect(ids(result?.messages)).toEqual(['u1', 'a1', 'a1b']);
      expect(executionIds(result?.state)).toEqual(['t1', 't1b']);
      expect(ids(cut(shownRoot, entries, 'a1', false)?.messages)).toEqual(['u1', 'a1']);
    });

    it('drops the hidden rows of earlier turns too when keepAlternatives is false', () => {
      const earlier = [
        user('u1', 't1'),
        bot('a1', 't1', off),
        alt('a1b', 't1b', 't1'),
        user('u2', 't2'),
        bot('a2', 't2'),
      ];
      expect(ids(cut(earlier, { turns: [] }, 'a2')?.messages)).toEqual(['u1', 'a1', 'a1b', 'u2', 'a2']);
      expect(ids(cut(earlier, { turns: [] }, 'a2', false)?.messages)).toEqual(['u1', 'a1b', 'u2', 'a2']);
    });
  });

  describe('turn entries', () => {
    it('keeps a reply-less completed turn before the cut and drops one after it', () => {
      const state = {
        turns: [
          turnEntry('t1'),
          turnEntry('r1', [setWrite('note', 'before')], { replies: 0 }),
          turnEntry('t2'),
          turnEntry('r2', [setWrite('note', 'after')], { replies: 0 }),
          turnEntry('t3'),
        ],
      };
      expect(executionIds(cut(linear, state, 'a2')?.state)).toEqual(['t1', 'r1', 't2']);
      expect(executionIds(cut(linear, state, 'a1')?.state)).toEqual(['t1']);
      expect(executionIds(cut(linear, state, 'a3')?.state)).toEqual(['t1', 'r1', 't2', 'r2', 't3']);
    });

    it('gives no entries when none belongs to a kept message, and an empty list for a chat without state', () => {
      expect(cut(linear, { turns: [turnEntry('other')] }, 'a1')?.state).toEqual({ turns: [] });
      for (const state of [undefined, null, 'junk', [], { turns: 'nope' }, {}])
        expect(cut(linear, state, 'a1')?.state).toEqual({ turns: [] });
    });

    it('keeps unknown keys of the state and raw entries it cannot read, as stored', () => {
      const unreadable = { executionId: 7, junk: true };
      const first = { ...turnEntry('t1'), extra: { kept: true } };
      const state = {
        turns: [unreadable, first, 'not an entry', turnEntry('t2'), unreadable, turnEntry('t3')],
        future: { a: 1 },
      };
      const result = cut(linear, state, 'a2');
      expect(result?.state).toEqual({ turns: state.turns.slice(0, 4), future: { a: 1 } });
      expect(result?.state.turns[0]).toBe(unreadable);
      expect(result?.state.turns[1]).toBe(first);
    });

    it('drops an unreadable entry that comes after the last kept turn', () => {
      const state = { turns: [{ nonsense: 1 }, turnEntry('t1'), { nonsense: 2 }, turnEntry('t2')] };
      expect(cut(linear, state, 'a1')?.state.turns).toEqual([{ nonsense: 1 }, state.turns[1]]);
    });
  });

  describe('messages', () => {
    it('keeps an empty-send turn (no user message of its own)', () => {
      const messages = [user('u1', 't1'), bot('a1', 't1'), bot('a2', 't2'), user('u3', 't3'), bot('a3', 't3')];
      const state = { turns: [turnEntry('t1'), turnEntry('t2'), turnEntry('t3')] };
      const result = cut(messages, state, 'a2');
      expect(ids(result?.messages)).toEqual(['u1', 'a1', 'a2']);
      expect(executionIds(result?.state)).toEqual(['t1', 't2']);
    });

    it('treats a reply without an execution id (older chat) as a turn of its own', () => {
      const messages: Row[] = [
        { id: 'u1', role: 'user' },
        { id: 'a1', role: 'assistant', status: 'final' },
        { id: 'u2', role: 'user' },
        { id: 'a2', role: 'assistant', status: 'final' },
      ];
      expect(ids(cut(messages, undefined, 'a1')?.messages)).toEqual(['u1', 'a1']);
      expect(ids(cut(messages, undefined, 'a2')?.messages)).toEqual(['u1', 'a1', 'u2', 'a2']);
    });

    it('keeps unknown fields and leaves streaming rows out', () => {
      const messages = [
        user('u1', 't1'),
        bot('a1', 't1', { note: { future: 1 } }),
        bot('s', 't1', { status: 'streaming' }),
        user('u2', 't2'),
        bot('a2', 't2', { status: 'streaming' }),
      ];
      const result = cut(messages, undefined, 'a1');
      expect(ids(result?.messages)).toEqual(['u1', 'a1']);
      expect(result?.messages[1]).toBe(messages[1]);
      expect(result?.messages[1]?.note).toEqual({ future: 1 });
    });
  });

  it.each<[string, string]>([
    ['a user message', 'u2'],
    ['a reply that is not the last of its turn', 'a1'],
    ['an unknown id', 'nope'],
    ['an inactive reply', 'hidden'],
    ['a streaming reply', 'live'],
  ])('is undefined for %s', (_, id) => {
    const messages = [
      user('u1', 't1'),
      bot('a1', 't1'),
      bot('b1', 't1'),
      user('u2', 't2'),
      bot('hidden', 't2', off),
      bot('live', 't2', { status: 'streaming' }),
    ];
    expect(cut(messages, { turns: [] }, id)).toBeUndefined();
  });
});

describe('the story state of a fork', () => {
  const turns = {
    t1: turnEntry('t1', [setWrite('tension', 4), addWrite('log', item('l1', 'first'))]),
    t2: turnEntry('t2', [setWrite('tension', 7), nodeAddWrite('draw-node', 'draws', item('d1', 'drawn'))]),
    r2: turnEntry('r2', [setWrite('note', 'reply-less, after t2')], { replies: 0 }),
    t3: turnEntry('t3', [setWrite('tension', 1), addWrite('log', item('l3', 'third'))]),
  };
  const state = { turns: [turns.t1, turns.t2, turns.r2, turns.t3] };
  const fold = (rows: Row[], entries: unknown[]) =>
    foldStoryState({ definitions: [scene], messages: rows, state: { turns: entries } });

  it('equals the source with the later turns removed (a reply-less turn after the cut does not apply)', () => {
    const result = cut(linear, state, 'a2')!;
    const forked = fold(result.messages, result.state.turns);
    expect(forked).toEqual(fold(linear.slice(0, 4), [turns.t1, turns.t2]));
    expect(forked.turn).toBe(3);
    expect(valueAt(forked, 'tension')).toBe(7);
    expect(valueAt(forked, 'note')).toBe('none');
    expect(forked.nodes).toHaveLength(1);
  });

  it('equals the whole source when forking at the last reply (a reply-less turn before the cut applies)', () => {
    const result = cut(linear, state, 'a3')!;
    const forked = fold(result.messages, result.state.turns);
    expect(forked).toEqual(fold(linear, state.turns));
    expect(valueAt(forked, 'note')).toBe('reply-less, after t2');
  });

  it('equals the source after the first turn alone', () => {
    const result = cut(linear, state, 'a1')!;
    const forked = fold(result.messages, result.state.turns);
    expect(forked).toEqual(fold(linear.slice(0, 2), [turns.t1]));
    expect(forked.turn).toBe(2);
  });

  it.each([true, false])(
    'a forked regenerated turn applies the shown alternative only (keepAlternatives: %s)',
    (keep) => {
      const regenerated = [
        user('u1', 't1'),
        bot('a1', 't1'),
        user('u2', 't2'),
        bot('a2', 't2', off),
        alt('a2b', 't2b', 't2'),
        user('u3', 't3'),
        bot('a3', 't3'),
      ];
      const entries = [
        turns.t1,
        turnEntry('t2', [setWrite('tension', 9)]),
        turnEntry('t2b', [setWrite('tension', 2)]),
        turns.t3,
      ];
      const result = cut(regenerated, { turns: entries }, 'a2b', keep)!;
      const forked = fold(result.messages, result.state.turns);
      expect(valueAt(forked, 'tension')).toBe(2);
      expect(forked).toEqual(fold(activeMessages(regenerated).slice(0, 4), entries.slice(0, 3)));
    },
  );

  it('is still readable by the state readers', () => {
    const result = cut(linear, { ...state, future: 1 }, 'a2')!;
    expect(readTurnEntries(result.state).map((e) => e.executionId)).toEqual(['t1', 't2']);
  });
});
