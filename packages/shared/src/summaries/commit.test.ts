import { describe, expect, it } from 'vitest';
import { commitSummaryWrites } from './commit.js';
import { chat, range, summaryOf } from './test-fixtures.js';
import { fingerprintMessages, readSummaries, type SummaryMessage, type SummaryWrite } from './summary.js';

const stamp = { executionId: 'exec-1', createdAt: '2026-02-02T00:00:00.000Z' };
const history = chat(10);
const writeOf = (ids: string[], over: Partial<SummaryWrite> = {}, from: SummaryMessage[] = history): SummaryWrite => ({
  id: `w-${ids[0]}`,
  nodeId: 'save',
  set: 'main',
  messageIds: ids,
  fingerprint: fingerprintMessages(ids.map((id) => from.find((m) => m.id === id)!)),
  text: 'the text',
  ...over,
});
const commit = (raw: unknown, writes: SummaryWrite[], now: SummaryMessage[] = history) =>
  commitSummaryWrites(raw, now, writes, stamp);

describe('commitSummaryWrites', () => {
  it('stores a write as a summary with the execution and time', () => {
    const result = commit(undefined, [writeOf(range(1, 4))]);
    expect(result.saved).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.summaries).toEqual({
      main: [
        {
          id: 'w-m1',
          messageIds: range(1, 4),
          fingerprint: writeOf(range(1, 4)).fingerprint,
          text: 'the text',
          createdAt: stamp.createdAt,
          executionId: 'exec-1',
        },
      ],
    });
  });
  it('appends to the set and leaves other sets and unknown fields alone', () => {
    const existing = { ...summaryOf(history, range(1, 4)), extra: 'kept' };
    const raw = { main: [existing], other: [{ weird: true }], note: 5 };
    const result = commit(raw, [writeOf(range(5, 8))]);
    expect(result.summaries).toMatchObject({ main: [existing, { id: 'w-m5' }], other: [{ weird: true }], note: 5 });
    expect(raw.main).toHaveLength(1);
  });
  it('keeps stored items it cannot read', () => {
    const result = commit({ main: ['junk', summaryOf(history, range(1, 4))] }, [writeOf(range(5, 8))]);
    expect((result.summaries.main as unknown[])[0]).toBe('junk');
    expect(readSummaries(result.summaries).main).toHaveLength(2);
  });
  it('treats a malformed store as empty', () => {
    expect(commit('nonsense', [writeOf(range(1, 2))]).saved).toBe(1);
    expect(commit([1, 2], [writeOf(range(1, 2))]).summaries).toMatchObject({ main: [{ id: 'w-m1' }] });
  });
  it('removes the summary a write replaces', () => {
    const old = summaryOf(history, range(1, 4));
    const edited = history.map((m) => (m.id === 'm2' ? { ...m, content: 'edited' } : m));
    const result = commit({ main: [old] }, [writeOf(range(1, 4), { replaces: old.id }, edited)], edited);
    expect(result.warnings).toEqual([]);
    expect((result.summaries.main as { id: string }[]).map((s) => s.id)).toEqual(['w-m1']);
  });
  it('drops a write whose fingerprint no longer matches (edited meanwhile) and says so', () => {
    const edited = history.map((m) => (m.id === 'm3' ? { ...m, content: 'edited' } : m));
    const raw = { main: [] };
    const result = commit(raw, [writeOf(range(1, 4))], edited);
    expect(result.saved).toBe(0);
    expect(result.summaries).toBe(raw);
    expect(result.warnings).toEqual([
      'The summary for set "main" was not saved: a message it covers was edited or deleted while it was being written.',
    ]);
  });
  it('drops a write when a covered message was deleted meanwhile', () => {
    const result = commit(
      undefined,
      [writeOf(range(1, 4))],
      history.filter((m) => m.id !== 'm4'),
    );
    expect(result.saved).toBe(0);
    expect(result.warnings).toHaveLength(1);
  });
  it('a dropped write does not remove the summary it replaces', () => {
    const old = summaryOf(history, range(1, 4));
    const edited = history.map((m) => (m.id === 'm1' ? { ...m, content: 'edited' } : m));
    const result = commit({ main: [old] }, [writeOf(range(1, 4), { replaces: old.id })], [...edited]);
    expect(result.summaries).toEqual({ main: [old] });
  });
  it('drops a write that overlaps a valid stored summary of the same set', () => {
    const result = commit({ main: [summaryOf(history, range(1, 4))] }, [writeOf(range(3, 6))]);
    expect(result.saved).toBe(0);
    expect(result.warnings[0]).toContain('another summary of the set already covers some of its messages');
  });
  it('allows an overlap with an invalid stored summary, with another set, or with the one it replaces', () => {
    const edited = history.map((m) => (m.id === 'm2' ? { ...m, content: 'edited' } : m));
    const stale = summaryOf(history, range(1, 4));
    expect(commit({ main: [stale] }, [writeOf(range(3, 6), {}, edited)], edited).saved).toBe(1);
    expect(commit({ other: [summaryOf(history, range(1, 4))] }, [writeOf(range(3, 6))]).saved).toBe(1);
    expect(commit({ main: [stale] }, [writeOf(range(1, 4), { replaces: stale.id })]).saved).toBe(1);
  });
  it('commits several writes in order, each checked against the ones before it', () => {
    const result = commit(undefined, [
      writeOf(range(1, 4)),
      writeOf(range(3, 6), { id: 'dup' }),
      writeOf(range(5, 8), { set: 'detail' }),
      writeOf(range(5, 8)),
    ]);
    expect(result.saved).toBe(3);
    expect(result.warnings).toHaveLength(1);
    expect(Object.keys(result.summaries)).toEqual(['main', 'detail']);
    expect((result.summaries.main as { id: string }[]).map((s) => s.id)).toEqual(['w-m1', 'w-m5']);
  });
  it('does nothing without writes', () => {
    const raw = { main: [] };
    const result = commit(raw, []);
    expect(result).toEqual({ summaries: raw, saved: 0, warnings: [] });
    expect(result.summaries).toBe(raw);
  });
});
