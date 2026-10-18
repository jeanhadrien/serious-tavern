import type { SessionStateView, SummarySetView, SummaryView } from '@st/shared';

/** What a summary row shows besides its text, worked out from the server's view (no folding on the web). */
export interface SummaryRow {
  id: string;
  /** "messages 21–40 (20)", or how many are left when some were deleted. */
  label: string;
  valid: boolean;
  /** Why it is not used (absent for a valid one). */
  explanation?: string;
  /** Where clicking the label scrolls to: the first covered message still in the chat. */
  jumpTo?: string;
  text: string;
  createdAt: string;
}

export interface SummarySetBlock {
  set: string;
  rows: SummaryRow[];
}

/** Said for a summary that is not used any more (spec wording). */
export const STALE_EXPLANATION =
  "A covered message was edited or deleted; raw messages are used until it's summarized again.";
/** Said when the chat holds none of the messages a summary covered. */
export const GONE_EXPLANATION =
  'Every message this summary covered was deleted, so it is not used and there is nothing left to summarize.';

/** "messages 21–40 (20)"; "message 7 (1)"; with deletions "messages 21–38 (18 of 20 left)"; none left "no messages left (0 of 20)". */
export function chunkLabel(summary: Pick<SummaryView, 'covered' | 'missing' | 'firstIndex' | 'lastIndex'>): string {
  const { covered, missing, firstIndex, lastIndex } = summary;
  const left = Math.max(0, covered - missing);
  if (firstIndex === undefined || lastIndex === undefined || left === 0) return `no messages left (0 of ${covered})`;
  const range = firstIndex === lastIndex ? `message ${firstIndex}` : `messages ${firstIndex}–${lastIndex}`;
  return missing > 0 ? `${range} (${left} of ${covered} left)` : `${range} (${left})`;
}

export function summaryRow(summary: SummaryView): SummaryRow {
  const gone = summary.firstMessageId === undefined;
  return {
    id: summary.id,
    label: chunkLabel(summary),
    valid: summary.valid,
    ...(!summary.valid && { explanation: gone ? GONE_EXPLANATION : STALE_EXPLANATION }),
    ...(summary.firstMessageId !== undefined && { jumpTo: summary.firstMessageId }),
    text: summary.text,
    createdAt: summary.createdAt,
  };
}

/** The sets that hold at least one summary, in the view's order. A set with none is not worth a heading. */
export function summaryBlocks(sets: readonly SummarySetView[]): SummarySetBlock[] {
  return sets
    .filter((set) => set.summaries.length > 0)
    .map((set) => ({ set: set.set, rows: set.summaries.map(summaryRow) }));
}

export const viewSummaryBlocks = (view: SessionStateView): SummarySetBlock[] => summaryBlocks(view.summaries);

/** A stored timestamp for people ("Oct 18, 2026, 3:04 PM"); the raw text when it is not a date. */
export function formatCreated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
