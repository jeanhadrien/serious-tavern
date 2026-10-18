import { describe, expect, it } from 'vitest';
import {
  effectivePostRun,
  POST_ERROR_LIMIT,
  POST_INTERRUPTED_MESSAGE,
  type PostRun,
  SUMMARY_WARNING_LIMITS,
  withPostRun,
} from './post-run.js';
import { item, nodeAddWrite, setWrite, turnEntry } from './test-fixtures.js';
import { readTurnEntries } from './writes.js';

describe('effectivePostRun', () => {
  it.each<[string, Parameters<typeof effectivePostRun>[0], boolean, PostRun | undefined]>([
    ['no post fields', {}, false, undefined],
    ['an id without a status', { postExecutionId: 'p' }, true, undefined],
    ['an error text without a status', { postError: 'boom' }, true, undefined],
    [
      'running while the server holds it',
      { postExecutionId: 'p', postStatus: 'running' },
      true,
      { status: 'running', executionId: 'p' },
    ],
    [
      'running that the server no longer holds',
      { postExecutionId: 'p', postStatus: 'running' },
      false,
      { status: 'error', executionId: 'p', error: POST_INTERRUPTED_MESSAGE },
    ],
    [
      'running, not held, with a stored error text',
      { postExecutionId: 'p', postStatus: 'running', postError: 'old' },
      false,
      { status: 'error', executionId: 'p', error: POST_INTERRUPTED_MESSAGE },
    ],
    ['running without an id while held', { postStatus: 'running' }, true, { status: 'running' }],
    [
      'running without an id, not held',
      { postStatus: 'running' },
      false,
      { status: 'error', error: POST_INTERRUPTED_MESSAGE },
    ],
    ['completed', { postExecutionId: 'p', postStatus: 'completed' }, false, { status: 'completed', executionId: 'p' }],
    [
      'completed while held',
      { postExecutionId: 'p', postStatus: 'completed' },
      true,
      { status: 'completed', executionId: 'p' },
    ],
    [
      'an error with its message',
      { postExecutionId: 'p', postStatus: 'error', postError: 'boom' },
      false,
      { status: 'error', executionId: 'p', error: 'boom' },
    ],
    [
      'an error without a message',
      { postExecutionId: 'p', postStatus: 'error' },
      false,
      { status: 'error', executionId: 'p' },
    ],
    ['stopped', { postExecutionId: 'p', postStatus: 'stopped' }, false, { status: 'stopped', executionId: 'p' }],
    [
      'stopped with a stray error text',
      { postExecutionId: 'p', postStatus: 'stopped', postError: 'x' },
      false,
      { status: 'stopped', executionId: 'p' },
    ],
  ])('%s', (_, entry, live, expected) => {
    expect(effectivePostRun(entry, live)).toStrictEqual(expected);
  });
});

describe('withPostRun', () => {
  const reply = setWrite('tension', 4);
  const post = setWrite('tension', 5);
  const memory = nodeAddWrite('draw', 'draws', item('i'));
  const running = turnEntry('t1', [reply], { postExecutionId: 'p1', postStatus: 'running' });

  it('appends the post writes after the turn’s own, in order, and records the status', () => {
    const result = withPostRun({ turns: [running] }, 't1', { status: 'completed', writes: [post, memory] });
    expect(result.turns).toEqual([{ ...running, postStatus: 'completed', writes: [reply, post, memory] }]);
    expect(readTurnEntries(result)[0]?.writes).toEqual([reply, post, memory]);
  });

  it('appends dropped-summary warnings to the entry, cut and capped, and adds nothing without them', () => {
    const first = withPostRun({ turns: [{ ...running, summaryWarnings: ['reply part'] }] }, 't1', {
      status: 'completed',
      writes: [],
      summaryWarnings: ['post part'],
    });
    expect(readTurnEntries(first)[0]?.summaryWarnings).toEqual(['reply part', 'post part']);
    const many = withPostRun(first, 't1', {
      status: 'completed',
      writes: [],
      summaryWarnings: Array.from({ length: 9 }, (_, index) => `w${index}`.padEnd(400, 'x')),
    });
    const kept = readTurnEntries(many)[0]?.summaryWarnings ?? [];
    expect(kept).toHaveLength(SUMMARY_WARNING_LIMITS.count);
    expect(kept.every((text) => text.length === SUMMARY_WARNING_LIMITS.length)).toBe(true);
    expect(kept.at(-1)?.startsWith('w8')).toBe(true);
    const none = withPostRun({ turns: [running] }, 't1', { status: 'completed', writes: [], summaryWarnings: [] });
    expect(none.turns[0]).not.toHaveProperty('summaryWarnings');
  });

  it('never changes postExecutionId and leaves the other fields as they are', () => {
    const result = withPostRun({ turns: [running] }, 't1', { status: 'completed', writes: [] });
    expect(result.turns[0]).toMatchObject({
      executionId: 't1',
      at: running.at,
      completed: true,
      replies: 1,
      postExecutionId: 'p1',
    });
  });

  it.each([
    ['error', { status: 'error' as const, error: 'boom', writes: [] }, 'boom'],
    ['an error without a message', { status: 'error' as const, writes: [] }, undefined],
    ['an error with an empty message', { status: 'error' as const, error: '', writes: [] }, undefined],
    ['stopped, which has no message', { status: 'stopped' as const, error: 'ignored', writes: [] }, undefined],
    ['completed, which has no message', { status: 'completed' as const, error: 'ignored', writes: [] }, undefined],
  ])('postError for %s', (_, result, expected) => {
    const entry = withPostRun({ turns: [running] }, 't1', result).turns[0] as Record<string, unknown>;
    expect(entry.postStatus).toBe(result.status);
    expect(entry.postError).toBe(expected);
    expect('postError' in entry).toBe(expected !== undefined);
  });

  it(`cuts the error to ${POST_ERROR_LIMIT} characters`, () => {
    const entry = withPostRun({ turns: [running] }, 't1', { status: 'error', error: 'x'.repeat(2000), writes: [] })
      .turns[0] as Record<string, unknown>;
    expect(entry.postError).toBe('x'.repeat(POST_ERROR_LIMIT));
  });

  it('drops a stale postError when the status is not an error', () => {
    const stale = { ...running, postError: 'old' };
    const entry = withPostRun({ turns: [stale] }, 't1', { status: 'completed', writes: [] }).turns[0] as Record<
      string,
      unknown
    >;
    expect('postError' in entry).toBe(false);
  });

  it('replaces a stale postError with the new one', () => {
    const stale = { ...running, postError: 'old' };
    const entry = withPostRun({ turns: [stale] }, 't1', { status: 'error', error: 'new', writes: [] })
      .turns[0] as Record<string, unknown>;
    expect(entry.postError).toBe('new');
  });

  it('keeps unknown state keys, unknown entry keys, raw junk and the other entries as the same objects', () => {
    const other = turnEntry('t0', [setWrite('tension', 1)]);
    const odd = { hand: 'edited' };
    const entry = { ...running, summaries: ['kept'] };
    const state = { turns: [other, odd, 'junk', entry], extra: { a: 1 } };
    const result = withPostRun(state, 't1', { status: 'completed', writes: [post] });
    expect(result).toMatchObject({ extra: { a: 1 } });
    expect(result.turns[0]).toBe(other);
    expect(result.turns[1]).toBe(odd);
    expect(result.turns[2]).toBe('junk');
    expect(result.turns[3]).toMatchObject({ summaries: ['kept'], postStatus: 'completed' });
  });

  it('keeps writes this version cannot read when it appends', () => {
    const unreadable = { op: 'frobnicate' };
    const state = { turns: [{ ...running, writes: [unreadable, reply] }] };
    const entry = withPostRun(state, 't1', { status: 'completed', writes: [post] }).turns[0] as { writes: unknown[] };
    expect(entry.writes).toEqual([unreadable, reply, post]);
    expect(entry.writes[0]).toBe(unreadable);
  });

  it('starts a fresh list when the stored writes are not a list', () => {
    const state = { turns: [{ ...running, writes: 'nope' }] };
    const entry = withPostRun(state, 't1', { status: 'completed', writes: [post] }).turns[0] as { writes: unknown[] };
    expect(entry.writes).toEqual([post]);
  });

  it('records the status on the first entry with that execution id', () => {
    const twin = turnEntry('t1');
    const result = withPostRun({ turns: [running, twin] }, 't1', { status: 'completed', writes: [] });
    expect(result.turns[1]).toBe(twin);
  });

  it.each([
    ['an unknown execution id', { turns: [running] }, 'zzz'],
    ['no state', undefined, 't1'],
    ['null', null, 't1'],
    ['text', 'x', 't1'],
    ['turns that are not a list', { turns: 'x' }, 't1'],
  ])('gives the state back unchanged for %s', (_, state, executionId) => {
    expect(withPostRun(state, executionId, { status: 'completed', writes: [post] })).toBe(state);
  });

  it('never changes the state it is given', () => {
    const state = Object.freeze({
      turns: Object.freeze([Object.freeze({ ...running, writes: Object.freeze([reply]) })]),
    });
    expect(() => withPostRun(state, 't1', { status: 'error', error: 'boom', writes: [post] })).not.toThrow();
    expect(state.turns[0]?.writes).toEqual([reply]);
    expect(state.turns[0]?.postStatus).toBe('running');
  });
});
