import { describe, expect, it } from 'vitest';
import { sessionSchema } from '../models.js';
import { item, nodeAddWrite, setWrite, turnEntry } from './test-fixtures.js';
import { readTurnEntries, stateWriteSchema, turnEntrySchema, withTurnEntry } from './writes.js';

describe('stateWriteSchema', () => {
  const target = { kind: 'definition', definitionId: 'd', key: 'k' };
  it.each([
    ['set', { op: 'set', target, nodeId: 'n', value: 3 }],
    ['set with null', { op: 'set', target, nodeId: 'n', value: null }],
    ['set with an object', { op: 'set', target, nodeId: 'n', value: { a: [1] } }],
    ['add', { op: 'add', target, nodeId: 'n', item: { id: 'i', text: 't', level: 2 } }],
    ['remove', { op: 'remove', target, nodeId: 'n', itemId: 'i' }],
    ['delete', { op: 'delete', target, nodeId: 'n' }],
    [
      'a node target',
      { op: 'add', target: { kind: 'node', nodeId: 'n', key: 'draws' }, nodeId: 'n', item: { id: 'i', text: '' } },
    ],
    ['unknown fields', { op: 'delete', target: { ...target, extra: 1 }, nodeId: 'n', note: 'x' }],
  ])('accepts %s', (_, write) => {
    expect(stateWriteSchema.parse(write)).toEqual(write);
  });

  it.each([
    ['an unknown op', { op: 'increment', target, nodeId: 'n', by: 1 }],
    ['no target', { op: 'delete', nodeId: 'n' }],
    ['no writer', { op: 'delete', target }],
    ['an unknown target kind', { op: 'delete', target: { kind: 'x', key: 'k' }, nodeId: 'n' }],
    ['an add without an item', { op: 'add', target, nodeId: 'n' }],
    ['an item without an id', { op: 'add', target, nodeId: 'n', item: { text: 't' } }],
    ['an item with an empty id', { op: 'add', target, nodeId: 'n', item: { id: '', text: 't' } }],
    ['a remove without an item id', { op: 'remove', target, nodeId: 'n' }],
    ['a set without a value key', { op: 'set', target, nodeId: 'n' }],
  ])('rejects %s', (_, write) => {
    expect(stateWriteSchema.safeParse(write).success).toBe(false);
  });
});

describe('turnEntrySchema', () => {
  it('defaults writes to a list and keeps unknown fields (later phases add some)', () => {
    const parsed = turnEntrySchema.parse({
      executionId: 'e',
      at: 't',
      completed: true,
      replies: 0,
      postRun: { id: 'p' },
    });
    expect(parsed.writes).toEqual([]);
    expect(parsed).toMatchObject({ postRun: { id: 'p' } });
  });

  it.each([
    ['a negative reply count', { replies: -1 }],
    ['a fractional reply count', { replies: 1.5 }],
    ['an empty execution id', { executionId: '' }],
    ['completed as text', { completed: 'yes' }],
  ])('rejects %s', (_, over) => {
    expect(turnEntrySchema.safeParse({ executionId: 'e', at: 't', completed: true, replies: 0, ...over }).success).toBe(
      false,
    );
  });
});

describe('readTurnEntries', () => {
  const good = turnEntry('a', [setWrite('n', 1)]);

  it('reads entries in stored order', () => {
    expect(readTurnEntries({ turns: [good, turnEntry('b')] }).map((entry) => entry.executionId)).toEqual(['a', 'b']);
  });

  it.each([undefined, null, 'x', 5, true, [], [good], {}, { turns: null }, { turns: {} }, { turns: 'x' }])(
    'reads %j as no entries',
    (state) => {
      expect(readTurnEntries(state)).toEqual([]);
    },
  );

  it('skips entries that are not entries and keeps the rest', () => {
    const state = { turns: [good, 'x', null, { executionId: 'b' }, { ...good, replies: 'many' }, turnEntry('c')] };
    expect(readTurnEntries(state).map((entry) => entry.executionId)).toEqual(['a', 'c']);
  });

  it('skips a write it cannot read without dropping its turn', () => {
    const state = { turns: [{ ...good, writes: [{ op: 'frobnicate' }, setWrite('n', 2), 7, null] }] };
    const [entry] = readTurnEntries(state);
    expect(entry?.writes).toEqual([setWrite('n', 2)]);
  });

  it('gives an entry without writes an empty list and keeps its unknown fields', () => {
    const { writes: _, ...bare } = good;
    expect(readTurnEntries({ turns: [{ ...bare, extra: 1 }] })).toEqual([{ ...bare, writes: [], extra: 1 }]);
  });

  it('does not change what it reads', () => {
    const state = Object.freeze({
      turns: Object.freeze([Object.freeze({ ...good, writes: Object.freeze([...good.writes]) })]),
    });
    expect(() => readTurnEntries(state)).not.toThrow();
  });
});

describe('withTurnEntry', () => {
  const entry = turnEntry('new', [nodeAddWrite('n', 'draws', item('i'))]);

  it('starts a list from a missing or malformed state', () => {
    for (const state of [undefined, null, 'x', 5, [], {}, { turns: 'x' }, { turns: {} }])
      expect(withTurnEntry(state, entry)).toEqual({ turns: [entry] });
  });

  it('appends after the earlier items', () => {
    const first = turnEntry('first');
    expect(withTurnEntry({ turns: [first] }, entry)).toEqual({ turns: [first, entry] });
  });

  it('keeps unknown keys of the state and raw items it cannot read', () => {
    const odd = { hand: 'edited' };
    const state = { turns: [odd, 'junk'], summaries: { main: [] } };
    const result = withTurnEntry(state, entry);
    expect(result).toEqual({ turns: [odd, 'junk', entry], summaries: { main: [] } });
    expect(result.turns[0]).toBe(odd);
  });

  it('never changes the state it is given', () => {
    const state = { turns: [turnEntry('first')], keep: 1 };
    const copy = structuredClone(state);
    withTurnEntry(state, entry);
    expect(state).toEqual(copy);
  });
});

describe('session and message schemas', () => {
  const session = { id: 's', title: 'T', workflowId: 'w', messages: [], createdAt: '', updatedAt: '' };

  it('loads sessions with and without state', () => {
    expect(sessionSchema.parse(session)).toEqual(session);
    const withState = { ...session, state: { turns: [turnEntry('a', [setWrite('n', 1)])] } };
    expect(sessionSchema.parse(withState)).toEqual(withState);
    expect(sessionSchema.parse({ ...session, state: { turns: [], extra: 1 } }).state).toEqual({ turns: [], extra: 1 });
  });

  it('keeps editedAt on messages and does not require it', () => {
    const message = { id: 'm', role: 'user', content: 'hi', createdAt: '' };
    const parsed = sessionSchema.parse({
      ...session,
      messages: [message, { ...message, id: 'n', editedAt: '2026-02-02' }],
    });
    expect(parsed.messages.map((m) => m.editedAt)).toEqual([undefined, '2026-02-02']);
  });
});
