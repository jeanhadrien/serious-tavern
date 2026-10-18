import { describe, expect, it } from 'vitest';
import { composeHistory, type HistoryPart } from './compose.js';
import { chat, range, summaryOf } from './test-fixtures.js';
import type { Summary, SummaryMessage } from './summary.js';

/** `s:<first>-<last>` for a summary, `m<k>` for a message. */
const shape = (parts: HistoryPart[]) =>
  parts.map((part) =>
    part.kind === 'message' ? part.message.id : `s:${part.summary.messageIds[0]}-${part.summary.messageIds.at(-1)}`,
  );
const compose = (history: SummaryMessage[], summaries: Summary[], lastN: number) =>
  composeHistory({ history, summaries, lastN });

describe('composeHistory', () => {
  const history = chat(12);
  const s1 = summaryOf(history, range(1, 4));
  const s2 = summaryOf(history, range(5, 8));

  it('shows everything raw when there are no summaries', () => {
    expect(shape(compose(history, [], 4).parts)).toEqual(range(1, 12));
  });
  it('replaces the runs a valid summary covers and keeps the last N raw', () => {
    expect(shape(compose(history, [s1, s2], 4).parts)).toEqual(['s:m1-m4', 's:m5-m8', ...range(9, 12)]);
  });
  it('keeps uncovered older messages raw, in order', () => {
    expect(shape(compose(history, [s2], 4).parts)).toEqual([...range(1, 4), 's:m5-m8', ...range(9, 12)]);
  });
  it('does not depend on the stored order of summaries', () => {
    expect(shape(compose(history, [s2, s1], 4).parts)).toEqual(['s:m1-m4', 's:m5-m8', ...range(9, 12)]);
  });
  it.each<[string, (m: SummaryMessage) => SummaryMessage | undefined]>([
    ['an edited message', (m) => (m.id === 'm2' ? { ...m, content: 'edited' } : m)],
    ['a deleted message', (m) => (m.id === 'm2' ? undefined : m)],
  ])('falls back to raw messages for the chunk after %s (the others stay summarized)', (_, change) => {
    const changed = history.flatMap((m) => change(m) ?? []);
    const shown = shape(compose(changed, [s1, s2], 4).parts);
    expect(shown).toEqual([
      ...changed.slice(0, changed.length === 12 ? 4 : 3).map((m) => m.id),
      's:m5-m8',
      ...range(9, 12),
    ]);
  });
  it('does not use a summary that straddles the raw boundary: its messages stay raw', () => {
    // lastN 6: the raw part is m7..m12, so s2 (m5..m8) straddles.
    expect(shape(compose(history, [s1, s2], 6).parts)).toEqual(['s:m1-m4', ...range(5, 12)]);
  });
  it('uses a summary that ends right before the raw part', () => {
    expect(shape(compose(history, [s1, s2], 4).parts).slice(0, 2)).toEqual(['s:m1-m4', 's:m5-m8']);
  });
  it('lastN 0: the raw part is empty and every message is older', () => {
    expect(shape(compose(history, [s1], 0).parts)).toEqual(['s:m1-m4', ...range(5, 12)]);
    expect(shape(compose(history, [s1, s2, summaryOf(history, range(9, 12))], 0).parts)).toEqual([
      's:m1-m4',
      's:m5-m8',
      's:m9-m12',
    ]);
  });
  it('lastN larger than the chat: everything is raw', () => {
    expect(shape(compose(history, [s1, s2], 50).parts)).toEqual(range(1, 12));
  });
  it('never shows a message twice: the later of two overlapping summaries is not used', () => {
    const overlap = summaryOf(history, range(3, 6), 'overlap');
    const shown = shape(compose(history, [overlap, s1], 4).parts);
    expect(shown).toEqual(['s:m1-m4', ...range(5, 12)]);
    expect(new Set(shown).size).toBe(shown.length);
  });
  it('puts a summary where its first message was', () => {
    const middle = summaryOf(history, range(3, 5));
    expect(shape(compose(history, [middle], 4).parts)).toEqual(['m1', 'm2', 's:m3-m5', ...range(6, 12)]);
  });
  it('counts the summaries it did not use', () => {
    const stale = summaryOf(history, range(1, 4), 'stale');
    const edited = history.map((m) => (m.id === 'm1' ? { ...m, content: 'x' } : m));
    expect(compose(edited, [stale, s2], 4).unused).toBe(1);
    expect(compose(history, [s1, s2], 6).unused).toBe(1);
    expect(compose(history, [s1, s2], 4).unused).toBe(0);
  });
  it('is the same objects it was given', () => {
    const [part] = compose(history, [], 4).parts;
    expect(part).toEqual({ kind: 'message', message: history[0] });
    if (part?.kind === 'message') expect(part.message).toBe(history[0]);
  });
});
