import { describe, expect, it } from 'vitest';
import {
  activeMessages,
  alternativesOfLastTurn,
  withActiveAlternative,
  withoutLastTurnReplies,
  type AlternativeMessage,
} from './alternatives.js';
import { messageSchema } from './models.js';
import { foldStoryState } from './state/fold.js';
import { definition, setWrite, turnEntry, valueAt } from './state/test-fixtures.js';

type Row = AlternativeMessage & { content?: string };

const user = (id: string, executionId?: string): Row => ({ id, role: 'user', ...(executionId && { executionId }) });
const bot = (id: string, executionId: string, extra: Partial<Row> = {}): Row => ({
  id,
  role: 'assistant',
  executionId,
  status: 'final',
  ...extra,
});
/** A reply of a regenerated alternative of `root`. */
const alt = (id: string, executionId: string, root: string, extra: Partial<Row> = {}): Row =>
  bot(id, executionId, { alternativeOf: root, ...extra });
const off = { inactive: true } as const;

const ids = (messages: readonly Row[] | undefined) => messages?.map((m) => m.id);

describe('activeMessages', () => {
  it('drops the inactive messages, keeps order and identity', () => {
    const a = bot('a', 'e1');
    const b = bot('b', 'e2', off);
    const c = bot('c', 'e3', { inactive: false });
    const result = activeMessages([a, b, c]);
    expect(result).toEqual([a, c]);
    expect(result[0]).toBe(a);
  });

  it('keeps every stored message that has no field (older sessions)', () => {
    const old = [user('u', 'e1'), bot('a', 'e1')];
    expect(activeMessages(old)).toEqual(old);
    expect(activeMessages([])).toEqual([]);
  });
});

describe('alternativesOfLastTurn', () => {
  it.each<[string, Row[], null]>([
    ['no messages', [], null],
    ['only a user message', [user('u1', 'e1')], null],
    ['a user message after the last reply', [user('u1', 'e1'), bot('a1', 'e1'), user('u2', 'e2')], null],
    [
      'a streaming reply after a newer user message',
      [bot('a1', 'e1'), user('u2', 'e2'), bot('a2', 'e2', { status: 'streaming' })],
      null,
    ],
    ['a reply without an execution id (legacy)', [user('u1'), { id: 'a1', role: 'assistant' }], null],
    ['only inactive replies', [user('u1', 'e1'), bot('a1', 'e1', off)], null],
  ])('is null for %s', (_, messages, expected) => {
    expect(alternativesOfLastTurn(messages)).toBe(expected);
  });

  it('finds the single alternative of a turn that was never regenerated', () => {
    expect(alternativesOfLastTurn([user('u1', 'e1'), bot('a1', 'e1'), bot('a2', 'e1')])).toEqual({
      rootId: 'e1',
      alternatives: [{ executionId: 'e1', messageIds: ['a1', 'a2'] }],
      activeExecutionId: 'e1',
      activeIndex: 0,
      lastReplyId: 'a2',
    });
  });

  it('groups by the root and orders alternatives as they were created', () => {
    const messages = [
      user('u1', 'e1'),
      bot('a1', 'e1', off),
      alt('b1', 'e2', 'e1', off),
      alt('b2', 'e2', 'e1', off),
      alt('c1', 'e3', 'e1'),
    ];
    expect(alternativesOfLastTurn(messages)).toEqual({
      rootId: 'e1',
      alternatives: [
        { executionId: 'e1', messageIds: ['a1'] },
        { executionId: 'e2', messageIds: ['b1', 'b2'] },
        { executionId: 'e3', messageIds: ['c1'] },
      ],
      activeExecutionId: 'e3',
      activeIndex: 2,
      lastReplyId: 'c1',
    });
  });

  it('follows a swipe back: the active alternative is not the newest one', () => {
    const messages = [user('u1', 'e1'), bot('a1', 'e1'), alt('b1', 'e2', 'e1', off), alt('b2', 'e2', 'e1', off)];
    const result = alternativesOfLastTurn(messages);
    expect(result).toMatchObject({ activeExecutionId: 'e1', activeIndex: 0, lastReplyId: 'a1' });
    expect(result?.alternatives.map((a) => a.executionId)).toEqual(['e1', 'e2']);
  });

  it('keeps the active alternative when it is a regenerated one and the root is deleted', () => {
    const messages = [user('u1', 'e1'), alt('b1', 'e2', 'e1')];
    expect(alternativesOfLastTurn(messages)).toMatchObject({
      rootId: 'e1',
      alternatives: [{ executionId: 'e2', messageIds: ['b1'] }],
      activeIndex: 0,
    });
  });

  it('does not take the user message that shares the root execution id for a reply', () => {
    const result = alternativesOfLastTurn([user('u1', 'e1'), bot('a1', 'e1')]);
    expect(result?.alternatives).toEqual([{ executionId: 'e1', messageIds: ['a1'] }]);
  });

  it('leaves older turns out', () => {
    const messages = [user('u1', 'e1'), bot('a1', 'e1'), alt('b1', 'e2', 'e1', off), user('u2', 'e3'), bot('a3', 'e3')];
    expect(alternativesOfLastTurn(messages)).toMatchObject({
      rootId: 'e3',
      alternatives: [{ executionId: 'e3', messageIds: ['a3'] }],
    });
  });

  it('works for a turn that followed an empty send (no user message of its own)', () => {
    const messages = [user('u1', 'e1'), bot('a1', 'e1'), bot('b1', 'e2', off), alt('b2', 'e3', 'e2')];
    expect(alternativesOfLastTurn(messages)).toMatchObject({
      rootId: 'e2',
      alternatives: [
        { executionId: 'e2', messageIds: ['b1'] },
        { executionId: 'e3', messageIds: ['b2'] },
      ],
      activeExecutionId: 'e3',
    });
  });

  it('works for a chat that starts with an empty send', () => {
    expect(alternativesOfLastTurn([bot('a1', 'e1')])).toMatchObject({ rootId: 'e1', lastReplyId: 'a1' });
  });

  it('ignores a streaming row (a regenerate in progress) and a partial reply counts as a reply', () => {
    const running = [user('u1', 'e1'), bot('a1', 'e1'), alt('b1', 'e2', 'e1', { status: 'streaming' })];
    expect(alternativesOfLastTurn(running)?.alternatives).toEqual([{ executionId: 'e1', messageIds: ['a1'] }]);
    const stopped = [user('u1', 'e1'), bot('a1', 'e1', off), alt('b1', 'e2', 'e1', { status: 'partial' })];
    expect(alternativesOfLastTurn(stopped)).toMatchObject({ activeExecutionId: 'e2', lastReplyId: 'b1' });
  });
});

describe('withActiveAlternative', () => {
  const messages = [
    user('u1', 'e1'),
    bot('a1', 'e1', off),
    bot('a2', 'e1', off),
    alt('b1', 'e2', 'e1'),
    alt('c1', 'e3', 'e1', off),
  ];

  it('makes the chosen execution the only active one of the group', () => {
    const result = withActiveAlternative(messages, 'e1');
    expect(result).toEqual([
      user('u1', 'e1'),
      bot('a1', 'e1'),
      bot('a2', 'e1'),
      alt('b1', 'e2', 'e1', off),
      alt('c1', 'e3', 'e1', off),
    ]);
    // Absent, never `false`.
    expect('inactive' in result![1]!).toBe(false);
    expect(ids(activeMessages(result!))).toEqual(['u1', 'a1', 'a2']);
  });

  it('does not change the input, and keeps the identity of messages that do not change', () => {
    const before = structuredClone(messages);
    const result = withActiveAlternative(messages, 'e3')!;
    expect(messages).toEqual(before);
    expect(result[0]).toBe(messages[0]);
    expect(result[1]).toBe(messages[1]);
    expect(result[4]).toEqual(alt('c1', 'e3', 'e1'));
  });

  it('is idempotent and round-trips through the alternatives', () => {
    const once = withActiveAlternative(messages, 'e2')!;
    expect(withActiveAlternative(once, 'e2')).toEqual(once);
    expect(alternativesOfLastTurn(once)).toMatchObject({ activeExecutionId: 'e2', activeIndex: 1 });
    const back = withActiveAlternative(once, 'e1')!;
    expect(alternativesOfLastTurn(back)).toMatchObject({ activeExecutionId: 'e1', activeIndex: 0 });
  });

  it('leaves messages outside the group alone', () => {
    const chat = [user('u0', 'e0'), bot('a0', 'e0'), ...messages];
    const result = withActiveAlternative(chat, 'e3')!;
    expect(result.slice(0, 2)).toEqual(chat.slice(0, 2));
  });

  it.each<[string, Row[], string]>([
    ['an execution outside the group', [user('u1', 'e1'), bot('a1', 'e1'), alt('b1', 'e2', 'e1', off)], 'e9'],
    ['an older turn', [user('u1', 'e1'), bot('a1', 'e1'), user('u2', 'e2'), bot('a2', 'e2')], 'e1'],
    ['no replies', [user('u1', 'e1')], 'e1'],
    ['the user message execution id of an empty group', [user('u1', 'e1'), user('u2', 'e2')], 'e2'],
  ])('is undefined for %s', (_, chat, executionId) => {
    expect(withActiveAlternative(chat, executionId)).toBeUndefined();
  });
});

describe('withoutLastTurnReplies', () => {
  it('drops every reply of the last turn, active or not, and every inactive message', () => {
    const chat = [user('u0', 'e0'), bot('a0', 'e0'), user('u1', 'e1'), bot('a1', 'e1', off), alt('b1', 'e2', 'e1')];
    expect(ids(withoutLastTurnReplies(chat))).toEqual(['u0', 'a0', 'u1']);
  });

  it('keeps the previous turn replies after an empty send', () => {
    const chat = [user('u0', 'e0'), bot('a0', 'e0'), bot('b1', 'e1', off), alt('b2', 'e2', 'e1')];
    expect(ids(withoutLastTurnReplies(chat))).toEqual(['u0', 'a0']);
  });

  it('is undefined without a last turn', () => {
    expect(withoutLastTurnReplies([user('u1', 'e1')])).toBeUndefined();
    expect(withoutLastTurnReplies([])).toBeUndefined();
  });
});

describe('story state through alternatives', () => {
  const scene = definition('scene', { tension: { type: 'number', default: 0, min: 0, max: 10 } });
  const entries = [
    turnEntry('e0', [setWrite('tension', 2)]),
    turnEntry('e1', [setWrite('tension', 5)]),
    turnEntry('e2', [setWrite('tension', 8)]),
  ];
  const fold = (messages: Row[], turn?: number) =>
    foldStoryState({ definitions: [scene], messages, state: { turns: entries }, ...(turn && { turn }) });
  const base = [user('u0', 'e0'), bot('a0', 'e0'), user('u1', 'e1')];

  it('an inactive reply undoes its turn writes', () => {
    const story = fold([...base, bot('a1', 'e1', off)]);
    expect(valueAt(story, 'tension')).toBe(2);
    expect(story.turns.map((t) => t.turn)).toEqual([1, null, null]);
    expect(story.turn).toBe(2);
  });

  it('flipping which alternative is active flips which writes apply', () => {
    const first = [...base, bot('a1', 'e1'), alt('b1', 'e2', 'e1', off)];
    expect(valueAt(fold(first), 'tension')).toBe(5);
    expect(fold(first).turns.map((t) => t.turn)).toEqual([1, 2, null]);

    const second = withActiveAlternative(first, 'e2')!;
    const story = fold(second);
    expect(valueAt(story, 'tension')).toBe(8);
    expect(story.turns.map((t) => t.turn)).toEqual([1, null, 2]);

    const back = withActiveAlternative(second, 'e1')!;
    expect(valueAt(fold(back), 'tension')).toBe(5);
  });

  it('a regenerate folds without the last turn: trigger.turn is the original number', () => {
    const chat = [...base, bot('a1', 'e1'), alt('b1', 'e2', 'e1', off)];
    expect(fold(chat).turn).toBe(3);
    const story = fold(withoutLastTurnReplies(chat)!);
    expect(story.turn).toBe(2);
    expect(valueAt(story, 'tension')).toBe(2);
  });

  it('sessions without the fields fold exactly as before', () => {
    const plain = [user('u0', 'e0'), bot('a0', 'e0'), user('u1', 'e1'), bot('a1', 'e1')];
    const story = fold(plain);
    expect(valueAt(story, 'tension')).toBe(5);
    expect(story.turns.map((t) => t.turn)).toEqual([1, 2, null]);
  });
});

describe('message schema', () => {
  const stored = { id: 'm', role: 'assistant', content: 'x', createdAt: '2026-01-01T00:00:00.000Z' };

  it('accepts messages with and without the alternative fields, and keeps unknown fields', () => {
    expect(messageSchema.parse(stored)).toEqual(stored);
    const withFields = { ...stored, alternativeOf: 'e1', inactive: true, future: 1 };
    expect(messageSchema.parse(withFields)).toEqual(withFields);
  });

  it('a message without the fields is active and alone in its turn', () => {
    const plain = [{ ...stored, role: 'assistant' as const, executionId: 'e1' }];
    expect(activeMessages(plain)).toEqual(plain);
    expect(alternativesOfLastTurn(plain)).toMatchObject({ rootId: 'e1', activeIndex: 0 });
  });
});
