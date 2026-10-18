import { describe, expect, it } from 'vitest';
import type { LinkMessage } from './fingerprint.js';
import { planNextChunk } from './plan.js';
import { chat, linkedItem, range, withEdit } from './test-fixtures.js';

type Item = ReturnType<typeof linkedItem> | { id: string; text: string };

const plan = (history: LinkMessage[], items: Item[] = [], chunkSize = 4, rawWindow = 3) =>
  planNextChunk({ history, items, chunkSize, rawWindow });
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
    ['empty', 0, 'Nothing to link: the chat has 0 messages, all within the last 3 kept raw.'],
    ['inside the window', 2, 'Nothing to link: the chat has 2 messages, all within the last 3 kept raw.'],
    ['a partial chunk', 6, 'Nothing to link yet: 3 messages outside the last 3 are not linked, and a chunk needs 4.'],
    ['one message', 4, 'Nothing to link yet: 1 message outside the last 3 is not linked, and a chunk needs 4.'],
  ])('says why there is nothing (%s)', (_, count, reason) => {
    expect(plan(chat(count)).reason).toBe(reason);
  });
});

describe('planNextChunk: with linked items', () => {
  const history = chat(20);
  const link = (...spans: [number, number][]) => spans.map(([a, b]) => linkedItem(history, range(a, b)));

  it('continues after the last intact item', () => {
    expect(ids(plan(history, link([1, 4])))).toEqual(range(5, 8));
  });

  it('continues after several, whatever the stored order', () => {
    const [a, b] = link([1, 4], [5, 8]);
    expect(ids(plan(history, [b!, a!]))).toEqual(range(9, 12));
  });

  it('ignores items without a link', () => {
    expect(ids(plan(history, [{ id: 'note', text: 'x' }]))).toEqual(range(1, 4));
  });

  it('stops when nothing outside the raw window is left', () => {
    const decision = plan(chat(19), link([1, 4], [5, 8], [9, 12], [13, 16]));
    expect(decision.chunk).toBeUndefined();
    expect(decision.reason).toBe(
      'Nothing to link: every message outside the last 3 is already linked by an intact item.',
    );
  });

  it('is not fooled by a partial chunk before the raw window', () => {
    // 13..17 are eligible (20 - 3): five messages, so one more chunk of 4 (13..16).
    expect(ids(plan(history, link([1, 4], [5, 8], [9, 12])))).toEqual(range(13, 16));
  });

  it('leaves a short remainder alone', () => {
    const decision = plan(chat(21), link([1, 4], [5, 8], [9, 12], [13, 16]));
    expect(decision.reason).toContain('2 messages outside the last 3 are not linked');
  });

  it('finds the first run of enough uncovered messages, also behind a gap', () => {
    // m1..m2 is a run of 2 (too short); m5.. is the first run of 4.
    expect(ids(plan(history, link([3, 4])))).toEqual(range(5, 8));
  });

  it('keeps an item of another size intact', () => {
    expect(ids(plan(history, link([1, 10])))).toEqual(range(11, 14));
  });

  it('does not care what kind of item links the messages', () => {
    const fact = { ...linkedItem(history, ['m1', 'm2', 'm3', 'm4'], 'fact'), mood: 'tense' };
    expect(ids(plan(history, [fact]))).toEqual(range(5, 8));
  });
});

describe('planNextChunk: broken items are re-planned first', () => {
  const history = chat(20);
  const first = linkedItem(history, range(1, 4));
  const second = linkedItem(history, range(5, 8));

  it('an edited linked message: the same messages, a new fingerprint, replacing the old item', () => {
    const decision = plan(withEdit(history, 'm6', 'edited'), [first, second]);
    expect(ids(decision)).toEqual(range(5, 8));
    expect(decision.chunk?.replaces).toBe(second.id);
    expect(decision.chunk?.fingerprint).not.toBe(second.messages.fingerprint);
  });

  it('a deleted linked message: the survivors only (boundaries stay by id)', () => {
    const decision = plan(withEdit(history, 'm2'), [first, second]);
    expect(ids(decision)).toEqual(['m1', 'm3', 'm4']);
    expect(decision.chunk?.replaces).toBe(first.id);
  });

  it('the FIRST broken one in chat order wins, not the first stored', () => {
    const broken = withEdit(withEdit(history, 'm2'), 'm6');
    expect(plan(broken, [second, first]).chunk?.replaces).toBe(first.id);
  });

  it('an item whose messages are all deleted is skipped, and its chunk is not re-planned', () => {
    const decision = plan(
      history.filter((m) => !range(1, 4).includes(m.id)),
      [first],
    );
    expect(decision.chunk?.replaces).toBeUndefined();
    expect(ids(decision)).toEqual(range(5, 8));
  });

  it('skips a gone item and re-plans the next broken one', () => {
    const rest = withEdit(
      history.filter((m) => !range(1, 4).includes(m.id)),
      'm6',
      'x',
    );
    expect(plan(rest, [first, second]).chunk?.replaces).toBe(second.id);
  });

  it('re-plans only survivors outside the raw window', () => {
    // 7 messages, window 3: eligible m1..m4. An item linking m3..m6 (made when the chat was longer) breaks on an edit.
    const short = chat(7);
    const item = linkedItem(short, range(3, 6));
    const decision = plan(withEdit(short, 'm5', 'edited'), [item]);
    expect(ids(decision)).toEqual(['m3', 'm4']);
    expect(decision.chunk?.replaces).toBe(item.id);
  });

  it('a broken item entirely inside the raw window is left alone', () => {
    const short = chat(7);
    const item = linkedItem(short, range(5, 7));
    const decision = plan(withEdit(short, 'm6', 'edited'), [item]);
    expect(decision.chunk?.replaces).toBeUndefined();
    expect(ids(decision)).toEqual(range(1, 4));
  });

  it('a re-planned chunk may be a single message', () => {
    const rest = history.filter((m) => !['m1', 'm2', 'm3'].includes(m.id));
    expect(ids(plan(rest, [first]))).toEqual(['m4']);
  });

  it('once an intact item replaces the broken one, the plan moves on', () => {
    const edited = withEdit(history, 'm2', 'edited');
    const redo = linkedItem(edited, range(1, 4), 'redo');
    expect(plan(edited, [first, second]).chunk?.replaces).toBe(first.id);
    expect(ids(plan(edited, [redo, first, second]))).toEqual(range(9, 12));
    expect(plan(edited, [redo, first, second]).chunk).not.toHaveProperty('replaces');
  });

  it('if the replacement goes away the broken item is re-planned again', () => {
    const edited = withEdit(history, 'm2', 'edited');
    const redo = linkedItem(edited, range(1, 4), 'redo');
    expect(ids(plan(edited, [redo, first]))).toEqual(range(5, 8));
    expect(plan(edited, [first]).chunk?.replaces).toBe(first.id);
  });

  it('a partly replaced item re-plans only what no intact item covers', () => {
    const edited = withEdit(history, 'm2', 'edited');
    const partial = linkedItem(edited, range(1, 2), 'partial');
    const decision = plan(edited, [partial, first]);
    expect(ids(decision)).toEqual(['m3', 'm4']);
    expect(decision.chunk?.replaces).toBe(first.id);
  });
});
