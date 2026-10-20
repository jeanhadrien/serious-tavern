import { describe, expect, it } from 'vitest';
import { sessionSchema } from '../models.js';
import { item, nodeAddWrite, setWrite, turnEntry } from './test-fixtures.js';
import {
  readTurnEntries,
  runStatusSchema,
  stateWriteSchema,
  turnEntrySchema,
  withTurnEntry,
  withUpdatedTurnEntry,
} from './writes.js';

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
    [
      'a node target of a workflow',
      {
        op: 'add',
        target: { kind: 'node', nodeId: 'n', key: 'draws', workflowId: 'w1' },
        nodeId: 'n',
        item: { id: 'i', text: '' },
      },
    ],
    ['unknown fields', { op: 'delete', target: { ...target, extra: 1 }, nodeId: 'n', note: 'x' }],
    [
      'an item linked to messages',
      {
        op: 'add',
        target,
        nodeId: 'n',
        item: { id: 'i', text: 't', messages: { ids: ['m1', 'm2'], fingerprint: 'f' } },
      },
    ],
    [
      'a link without a fingerprint yet',
      { op: 'add', target, nodeId: 'n', item: { id: 'i', text: 't', messages: { ids: ['m1'] } } },
    ],
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

describe('the message link of an item', () => {
  const target = { kind: 'definition', definitionId: 'd', key: 'k' };
  const parse = (messages: unknown) => {
    const write = { op: 'add', target, nodeId: 'n', item: { id: 'i', text: 't', messages } };
    const parsed = stateWriteSchema.parse(write);
    return parsed.op === 'add' ? parsed.item : undefined;
  };

  it('reads a link as it is and an item without one as having none', () => {
    expect(parse({ ids: ['m1'], fingerprint: 'f' })?.messages).toEqual({ ids: ['m1'], fingerprint: 'f' });
    expect(parse(undefined)?.messages).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ['no ids', { ids: [], fingerprint: 'f' }],
    ['ids that are not text', { ids: [1], fingerprint: 'f' }],
    ['an empty id', { ids: [''], fingerprint: 'f' }],
    ['an empty fingerprint', { ids: ['m1'], fingerprint: '' }],
    ['a number', 3],
    ['text', 'm1'],
    ['a list', ['m1']],
  ])('reads %s as no link and keeps the item', (_, messages) => {
    const item = parse(messages);
    expect(item).toMatchObject({ id: 'i', text: 't' });
    expect(item?.messages).toBeUndefined();
  });

  it('keeps an item with a bad link when reading stored turn entries', () => {
    const write = { op: 'add', target, nodeId: 'n', item: { id: 'i', text: 't', messages: 'junk' } };
    const [entry] = readTurnEntries({ turns: [{ ...turnEntry('e1'), writes: [write] }] });
    expect(entry?.writes).toHaveLength(1);
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

describe('the runs of an entry', () => {
  const base = { executionId: 'e', at: 't', completed: true, replies: 1 };
  const run = { executionId: 'r', workflowId: 'w', part: 'post', status: 'running' };

  it.each(runStatusSchema.options)('keeps a run that is %s', (status) => {
    const entry = { ...base, writes: [], runs: [{ ...run, status, error: 'boom' }] };
    expect(turnEntrySchema.parse(entry)).toStrictEqual(entry);
  });

  it('parses an entry without runs to an object without that key', () => {
    expect(turnEntrySchema.parse({ ...base, writes: [] })).toStrictEqual({ ...base, writes: [] });
    expect(readTurnEntries({ turns: [{ ...base, writes: [] }] })).toStrictEqual([{ ...base, writes: [] }]);
  });

  it('skips a run it cannot read and keeps the turn, its writes and the other runs', () => {
    const good = { ...run, executionId: 'ok' };
    const [entry] = readTurnEntries({
      turns: [{ ...base, writes: [setWrite('n', 1)], runs: [{ ...run, status: 'paused' }, good] }],
    });
    expect(entry).toMatchObject({ executionId: 'e', writes: [setWrite('n', 1)], runs: [good] });
  });

  it('reads an entry whose runs are all unreadable, or not a list, as one without runs', () => {
    for (const runs of [[{ nope: 1 }], 'oops']) {
      const [entry] = readTurnEntries({ turns: [{ ...base, writes: [], runs }] });
      expect(entry).toMatchObject({ executionId: 'e' });
      expect(entry?.runs).toBeUndefined();
    }
  });

  it('keeps the dropped-link warnings of a turn, and drops a bad value without losing the turn', () => {
    const entry = { ...base, writes: [], linkWarnings: ['memory.summaries: an item was not saved'] };
    expect(turnEntrySchema.parse(entry)).toStrictEqual(entry);
    const [bad] = readTurnEntries({ turns: [{ ...base, writes: [], linkWarnings: 'oops' }] });
    expect(bad).toMatchObject({ executionId: 'e', writes: [] });
    expect(bad?.linkWarnings).toBeUndefined();
  });

  it('accepts a session that stores them', () => {
    const state = { turns: [{ ...base, writes: [], runs: [run] }] };
    const session = { id: 's', title: 'T', workflowId: 'w', messages: [], createdAt: '', updatedAt: '', state };
    expect(sessionSchema.parse(session)).toEqual(session);
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

describe('withUpdatedTurnEntry', () => {
  const mark = (raw: Record<string, unknown>) => ({ ...raw, marked: true });

  it('replaces only the first item with that execution id and keeps everything else as it is', () => {
    const a = turnEntry('a');
    const b = turnEntry('b');
    const twin = turnEntry('b', [setWrite('n', 1)]);
    const state = { turns: [a, 'junk', b, twin], summaries: { main: [] } };
    const result = withUpdatedTurnEntry(state, 'b', mark);
    expect(result).toEqual({ turns: [a, 'junk', { ...b, marked: true }, twin], summaries: { main: [] } });
    expect(result.turns[0]).toBe(a);
    expect(result.turns[3]).toBe(twin);
  });

  it('hands update the raw item, including a hand-edited one this version cannot read', () => {
    const odd = { executionId: 'x', replies: 'many', writes: 'nope' };
    const result = withUpdatedTurnEntry({ turns: [odd] }, 'x', mark);
    expect(result.turns[0]).toEqual({ ...odd, marked: true });
  });

  it.each([
    ['an unknown execution id', { turns: [turnEntry('a')] }, 'zzz'],
    ['an item without an execution id', { turns: [{ id: 'a' }] }, 'a'],
    ['a list item', { turns: [['a']] }, 'a'],
    ['no state', undefined, 'a'],
    ['null', null, 'a'],
    ['text', 'x', 'a'],
    ['a list', [turnEntry('a')], 'a'],
    ['turns that are not a list', { turns: 'x' }, 'a'],
  ])('gives the state back unchanged for %s', (_, state, executionId) => {
    expect(withUpdatedTurnEntry(state, executionId, mark)).toBe(state);
  });

  it('never changes the state it is given', () => {
    const state = Object.freeze({ turns: Object.freeze([Object.freeze(turnEntry('a'))]) });
    expect(() => withUpdatedTurnEntry(state, 'a', mark)).not.toThrow();
    expect(state.turns[0]).not.toHaveProperty('marked');
  });
});

describe('the runs of an entry', () => {
  const good = turnEntry('a', [setWrite('n', 1)]);
  const reply = { executionId: 'r1', workflowId: 'w1', part: 'reply', status: 'completed' };
  const post = { executionId: 'r2', workflowId: 'w1', part: 'post', status: 'running', note: 'kept' };

  it('reads an entry without runs as it always was: no runs key', () => {
    expect(readTurnEntries({ turns: [good] })[0]).not.toHaveProperty('runs');
  });

  it('reads the runs in order, keeping unknown fields', () => {
    expect(readTurnEntries({ turns: [{ ...good, runs: [reply, post] }] })[0]!.runs).toEqual([reply, post]);
  });

  it('skips a run it cannot read without dropping the others or the turn', () => {
    const bad = [{ ...reply, status: 'weird' }, { ...reply, part: 'middle' }, 'x', null, { part: 'post' }];
    expect(readTurnEntries({ turns: [{ ...good, runs: [...bad, post] }] })[0]!.runs).toEqual([post]);
  });

  it('reads an entry whose runs are all unreadable, or not a list, as a legacy one', () => {
    for (const runs of [[{ junk: 1 }], [], 'x', 5, {}]) {
      const [entry] = readTurnEntries({ turns: [{ ...good, runs, postExecutionId: 'p', postStatus: 'running' }] });
      expect(entry).not.toHaveProperty('runs');
      expect(entry).toMatchObject({ executionId: 'a', postStatus: 'running' });
    }
  });

  it('drops a bad error text of a run, not the run', () => {
    expect(readTurnEntries({ turns: [{ ...good, runs: [{ ...reply, status: 'error', error: 5 }] }] })[0]!.runs).toEqual(
      [{ ...reply, status: 'error' }],
    );
  });

  it('keeps legacy post fields and runs side by side', () => {
    const [entry] = readTurnEntries({
      turns: [{ ...good, runs: [reply], postExecutionId: 'p', postStatus: 'completed' }],
    });
    expect(entry).toMatchObject({ runs: [reply], postExecutionId: 'p', postStatus: 'completed' });
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

  it('keeps the reply list and a message’s run id, and does not require them', () => {
    const triggers = { reply: [{ workflowId: 'w', enabled: false }], other: 1 };
    const message = { id: 'm', role: 'assistant', content: 'hi', createdAt: '', runId: 'r1' };
    const withBoth = { ...session, triggers, messages: [message] };
    expect(sessionSchema.parse(withBoth)).toEqual(withBoth);
    expect(sessionSchema.parse(session)).not.toHaveProperty('triggers');
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
