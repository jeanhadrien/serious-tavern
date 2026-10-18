import { describe, expect, it } from 'vitest';
import { planNextChunk } from './plan.js';
import { chat, range, summaryOf } from './test-fixtures.js';
import type { Summary, SummaryMessage } from './summary.js';

const plan = (history: SummaryMessage[], summaries: Summary[] = [], chunkSize = 4, rawWindow = 3) =>
  planNextChunk({ history, summaries, chunkSize, rawWindow });
const ids = (decision: ReturnType<typeof plan>) => decision.chunk?.messageIds;

describe('planNextChunk: a first chunk', () => {
  it.each<[string, number, number, number, string[] | undefined]>([
    // [name, messages, chunkSize, rawWindow, expected ids]
    ['an empty chat', 0, 4, 3, undefined],
    ['a chat shorter than the raw window', 2, 4, 3, undefined],
    ['exactly the raw window', 3, 4, 3, undefined],
    ['one chunk short of eligible messages', 6, 4, 3, undefined],
    ['exactly one chunk outside the raw window', 7, 4, 3, range(1, 4)],
    ['plenty of messages: the OLDEST chunk', 20, 4, 3, range(1, 4)],
    ['no raw window at all', 4, 4, 0, range(1, 4)],
    ['a chunk bigger than the chat', 5, 20, 0, undefined],
    ['chunks of 2', 5, 2, 3, range(1, 2)],
  ])('%s', (_, count, chunkSize, rawWindow, expected) => {
    expect(ids(plan(chat(count), [], chunkSize, rawWindow))).toEqual(expected);
  });
  it('returns the messages, a fingerprint, and no replaces', () => {
    const decision = plan(chat(10));
    expect(decision.chunk?.messages.map((m) => m.id)).toEqual(range(1, 4));
    expect(decision.chunk?.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(decision.chunk).not.toHaveProperty('replaces');
  });
  it.each<[string, number, string]>([
    ['empty', 0, 'Nothing to summarize: the chat has 0 messages, all within the last 3 kept raw.'],
    ['inside the window', 2, 'Nothing to summarize: the chat has 2 messages, all within the last 3 kept raw.'],
    [
      'a partial chunk',
      6,
      'Nothing to summarize yet: 3 messages outside the last 3 are not summarized, and a chunk needs 4.',
    ],
    [
      'one message',
      4,
      'Nothing to summarize yet: 1 message outside the last 3 is not summarized, and a chunk needs 4.',
    ],
  ])('says why there is nothing (%s)', (_, count, reason) => {
    expect(plan(chat(count)).reason).toBe(reason);
  });
});

describe('planNextChunk: with summaries', () => {
  const history = chat(20);
  it('continues after the last valid summary', () => {
    expect(ids(plan(history, [summaryOf(history, range(1, 4))]))).toEqual(range(5, 8));
  });
  it('continues after several, whatever the stored order', () => {
    const a = summaryOf(history, range(1, 4));
    const b = summaryOf(history, range(5, 8));
    expect(ids(plan(history, [b, a]))).toEqual(range(9, 12));
  });
  it('stops when nothing outside the raw window is left', () => {
    const summaries = [range(1, 4), range(5, 8), range(9, 12), range(13, 16)].map((r) => summaryOf(history, r));
    const decision = plan(chat(19), summaries);
    expect(decision.chunk).toBeUndefined();
    expect(decision.reason).toBe('Nothing to summarize: every message outside the last 3 is already summarized.');
  });
  it('is not fooled by a partial chunk before the raw window', () => {
    const summaries = [range(1, 4), range(5, 8), range(9, 12)].map((r) => summaryOf(history, r));
    // 13..17 are eligible (20 - 3): five messages, so one more chunk of 4 (13..16).
    expect(ids(plan(history, summaries))).toEqual(range(13, 16));
  });
  it('leaves a short remainder alone', () => {
    const summaries = [range(1, 4), range(5, 8), range(9, 12), range(13, 16)].map((r) => summaryOf(history, r));
    expect(plan(chat(21), summaries).reason).toContain('2 messages outside the last 3 are not summarized');
  });
  it('finds the first run of enough uncovered messages, also behind a gap', () => {
    const summaries = [summaryOf(history, range(3, 4))];
    // m1..m2 is a run of 2 (too short); m5.. is the first run of 4.
    expect(ids(plan(history, summaries))).toEqual(range(5, 8));
  });
  it('keeps a chunk of another size valid', () => {
    expect(ids(plan(history, [summaryOf(history, range(1, 10))]))).toEqual(range(11, 14));
  });
});

describe('planNextChunk: invalid summaries are re-planned first', () => {
  const history = chat(20);
  const first = summaryOf(history, range(1, 4));
  const second = summaryOf(history, range(5, 8));
  const edit = (id: string) => history.map((m) => (m.id === id ? { ...m, content: 'edited' } : m));
  it('an edited covered message: the same messages, a new fingerprint, replacing the old summary', () => {
    const decision = plan(edit('m6'), [first, second]);
    expect(ids(decision)).toEqual(range(5, 8));
    expect(decision.chunk?.replaces).toBe(second.id);
    expect(decision.chunk?.fingerprint).not.toBe(second.fingerprint);
  });
  it('a deleted covered message: the survivors only (boundaries stay by id)', () => {
    const decision = plan(
      history.filter((m) => m.id !== 'm2'),
      [first, second],
    );
    expect(ids(decision)).toEqual(['m1', 'm3', 'm4']);
    expect(decision.chunk?.replaces).toBe(first.id);
  });
  it('the FIRST invalid one in chat order wins, not the first stored', () => {
    const broken = history.filter((m) => m.id !== 'm2' && m.id !== 'm6');
    expect(plan(broken, [second, first]).chunk?.replaces).toBe(first.id);
  });
  it('an invalid summary whose messages are all deleted is skipped', () => {
    const decision = plan(
      history.filter((m) => !range(1, 4).includes(m.id)),
      [first],
    );
    expect(decision.chunk?.replaces).toBeUndefined();
    expect(ids(decision)).toEqual(range(5, 8));
  });
  it('skips it and replans the next invalid one', () => {
    const rest = history
      .filter((m) => !range(1, 4).includes(m.id))
      .map((m) => (m.id === 'm6' ? { ...m, content: 'x' } : m));
    expect(plan(rest, [first, second]).chunk?.replaces).toBe(second.id);
  });
  it('replans only survivors outside the raw window', () => {
    // 7 messages, window 3: eligible m1..m4. A summary of m3..m6 (made when the chat was longer) is invalid after an edit.
    const short = chat(7);
    const summary = summaryOf(short, range(3, 6));
    const edited = short.map((m) => (m.id === 'm5' ? { ...m, content: 'edited' } : m));
    const decision = plan(edited, [summary]);
    expect(ids(decision)).toEqual(['m3', 'm4']);
    expect(decision.chunk?.replaces).toBe(summary.id);
  });
  it('a re-planned chunk may be a single message', () => {
    const summary = summaryOf(history, range(1, 4));
    const rest = history.filter((m) => !['m1', 'm2', 'm3'].includes(m.id));
    expect(ids(plan(rest, [summary]))).toEqual(['m4']);
  });
  it('after the replacement is stored nothing is invalid any more', () => {
    const broken = history.filter((m) => m.id !== 'm2');
    const redo = summaryOf(broken, ['m1', 'm3', 'm4'], 'redo');
    expect(ids(plan(broken, [redo, second]))).toEqual(range(9, 12));
  });
  it('a valid summary that covers part of an invalid one keeps those messages covered', () => {
    const decision = plan(edit('m2'), [first, summaryOf(history, range(5, 8))]);
    expect(decision.chunk?.replaces).toBe(first.id);
  });
});
