import { describe, expect, it } from 'vitest';
import type { SummarySetView } from '@st/shared';
import {
  chunkLabel,
  formatCreated,
  GONE_EXPLANATION,
  STALE_EXPLANATION,
  summaryBlocks,
  summaryRow,
} from './summariesModel.js';
import { summary } from './test-fixtures.js';

describe('chunkLabel', () => {
  it.each([
    ['a full chunk', {}, 'messages 21–40 (20)'],
    ['a single message', { covered: 1, firstIndex: 7, lastIndex: 7 }, 'message 7 (1)'],
    ['some messages deleted', { lastIndex: 38, missing: 2 }, 'messages 21–38 (18 of 20 left)'],
    ['one left of several', { firstIndex: 30, lastIndex: 30, missing: 19 }, 'message 30 (1 of 20 left)'],
    ['none left', { missing: 20, firstIndex: undefined, lastIndex: undefined }, 'no messages left (0 of 20)'],
  ])('%s', (_name, extra, label) => {
    expect(chunkLabel(summary(extra))).toBe(label);
  });
});

describe('summaryRow', () => {
  it('a valid summary has no explanation and jumps to its first covered message', () => {
    const row = summaryRow(summary());
    expect(row).toMatchObject({ valid: true, jumpTo: 'm21', label: 'messages 21–40 (20)' });
    expect(row.explanation).toBeUndefined();
  });

  it('an edited one explains that raw messages are used until it is summarized again', () => {
    const row = summaryRow(summary({ valid: false }));
    expect(row.explanation).toBe(STALE_EXPLANATION);
    expect(row.explanation).toContain('a covered message was edited or deleted'.replace('a', 'A'));
    expect(row.explanation).toContain("raw messages are used until it's summarized again");
    expect(row.jumpTo).toBe('m21');
  });

  it('one with no message left has nowhere to jump and says so', () => {
    const row = summaryRow(
      summary({
        valid: false,
        missing: 20,
        firstIndex: undefined,
        lastIndex: undefined,
        firstMessageId: undefined,
        lastMessageId: undefined,
      }),
    );
    expect(row.jumpTo).toBeUndefined();
    expect(row.explanation).toBe(GONE_EXPLANATION);
  });
});

describe('summaryBlocks', () => {
  it('keeps the sets in order and leaves out a set with no summaries', () => {
    const sets: SummarySetView[] = [
      { set: 'main', summaries: [summary(), summary({ id: 's2', firstIndex: 41, lastIndex: 60 })] },
      { set: 'empty', summaries: [] },
      { set: 'arc', summaries: [summary({ id: 's3' })] },
    ];
    const blocks = summaryBlocks(sets);
    expect(blocks.map((block) => block.set)).toEqual(['main', 'arc']);
    expect(blocks[0]?.rows.map((row) => row.label)).toEqual(['messages 21–40 (20)', 'messages 41–60 (20)']);
  });

  it('is empty without sets', () => {
    expect(summaryBlocks([])).toEqual([]);
  });
});

describe('formatCreated', () => {
  it('formats a timestamp and returns anything else unchanged', () => {
    expect(formatCreated('2026-01-01T10:00:00.000Z')).toMatch(/2026/);
    expect(formatCreated('not a date')).toBe('not a date');
  });
});
