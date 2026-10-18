import {
  fingerprintMessages,
  indexById,
  readSummaries,
  summaryIsValid,
  type Summary,
  type SummaryMessage,
  type SummaryWrite,
} from './summary.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Stores the summaries a run wrote into a chat's stored `summaries`, at settle time and under the session lock.
 * `history` is the chat's history messages AS THEY ARE NOW: a write is dropped (with a warning in plain language)
 * when
 * - a message it covers is gone, or the covered messages no longer match the fingerprint taken when the chunk was
 *   planned (the chat changed while the summary was being written), or
 * - a valid stored summary of the set (other than the one it replaces) already covers one of its messages.
 * A write that replaces a summary removes it. Stored items this version cannot read are kept as they are, and
 * `raw` is never changed. `saved` is how many writes were stored; when 0, `summaries` is `raw` itself.
 */
export function commitSummaryWrites(
  raw: unknown,
  history: readonly SummaryMessage[],
  writes: readonly SummaryWrite[],
  stamp: { executionId: string; createdAt: string },
): { summaries: Record<string, unknown>; saved: number; warnings: string[] } {
  const byId = indexById(history);
  const warnings: string[] = [];
  let summaries: Record<string, unknown> = isRecord(raw) ? raw : {};
  let saved = 0;
  const reject = (write: SummaryWrite, why: string) =>
    warnings.push(`The summary for set "${write.set}" was not saved: ${why}.`);
  for (const write of writes) {
    const covered = write.messageIds.map((id) => byId.get(id));
    if (covered.some((message) => !message) || fingerprintMessages(covered as SummaryMessage[]) !== write.fingerprint) {
      reject(write, 'a message it covers was edited or deleted while it was being written');
      continue;
    }
    const taken = new Set(write.messageIds);
    const stored = readSummaries(summaries)[write.set] ?? [];
    if (
      stored.some(
        (item) =>
          item.id !== write.replaces && summaryIsValid(item, byId) && item.messageIds.some((id) => taken.has(id)),
      )
    ) {
      reject(write, 'another summary of the set already covers some of its messages');
      continue;
    }
    const items = Array.isArray(summaries[write.set]) ? (summaries[write.set] as unknown[]) : [];
    const kept = items.filter(
      (item) => !(isRecord(item) && write.replaces !== undefined && item.id === write.replaces),
    );
    const summary: Summary = {
      id: write.id,
      messageIds: write.messageIds,
      fingerprint: write.fingerprint,
      text: write.text,
      createdAt: stamp.createdAt,
      executionId: stamp.executionId,
    };
    summaries = { ...summaries, [write.set]: [...kept, summary] };
    saved++;
  }
  return { summaries, saved, warnings };
}
