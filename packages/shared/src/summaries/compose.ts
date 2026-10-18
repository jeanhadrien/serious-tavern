import { indexById, summaryIsValid, type Summary, type SummaryMessage } from './summary.js';

/** One item of a summarized history, in prompt order. */
export type HistoryPart<M extends SummaryMessage = SummaryMessage> =
  | { kind: 'summary'; summary: Summary }
  | { kind: 'message'; message: M };

/**
 * The history of a chat as Memory shows it with a summary set: the last `lastN` messages raw, and before them each
 * message either raw or replaced by the summary that covers it. A summary is used only when
 * - it is valid (every covered message still exists, unchanged), and
 * - ALL its messages lie before the raw part (a summary straddling the boundary is not used: its messages stay raw,
 *   so no message is ever shown twice and the raw part never shrinks), and
 * - none of its messages is already taken by an earlier summary.
 * A summary stands where its first covered message is. `lastN` 0 means an empty raw part, so every message is older.
 * `unused` counts the set's summaries that were not used, for the node's log.
 */
export function composeHistory<M extends SummaryMessage>(options: {
  history: readonly M[];
  summaries: readonly Summary[];
  lastN: number;
}): { parts: HistoryPart<M>[]; unused: number } {
  const { history, summaries, lastN } = options;
  const rawStart = Math.max(0, history.length - lastN);
  const index = new Map(history.map((message, at) => [message.id, at]));
  const byId = indexById(history);
  const usable = summaries
    .filter(
      (summary) =>
        summaryIsValid(summary, byId) && summary.messageIds.every((id) => (index.get(id) ?? Infinity) < rawStart),
    )
    .map((summary) => ({ summary, first: Math.min(...summary.messageIds.map((id) => index.get(id)!)) }))
    .sort((a, b) => a.first - b.first);
  const taken = new Set<string>();
  const startsAt = new Map<number, Summary>();
  for (const { summary, first } of usable) {
    if (summary.messageIds.some((id) => taken.has(id))) continue;
    for (const id of summary.messageIds) taken.add(id);
    startsAt.set(first, summary);
  }
  const parts: HistoryPart<M>[] = [];
  history.forEach((message, at) => {
    const summary = startsAt.get(at);
    if (summary) parts.push({ kind: 'summary', summary });
    if (!taken.has(message.id)) parts.push({ kind: 'message', message });
  });
  return { parts, unused: summaries.length - startsAt.size };
}
