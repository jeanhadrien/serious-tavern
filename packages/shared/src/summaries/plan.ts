import { fingerprintMessages, indexById, summaryIsValid, type Summary, type SummaryMessage } from './summary.js';

/** The next chunk to summarize: its messages, their fingerprint, and the invalid summary it replaces, if any. */
export type ChunkPlan<M extends SummaryMessage = SummaryMessage> = {
  messageIds: string[];
  messages: M[];
  fingerprint: string;
  replaces?: string;
};

export type ChunkDecision<M extends SummaryMessage = SummaryMessage> =
  | { chunk: ChunkPlan<M>; reason?: undefined }
  | { chunk?: undefined; reason: string };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function planOf<M extends SummaryMessage>(messages: M[], replaces?: string): ChunkPlan<M> {
  return {
    messageIds: messages.map((message) => message.id),
    messages,
    fingerprint: fingerprintMessages(messages),
    ...(replaces === undefined ? {} : { replaces }),
  };
}

/**
 * Plans one chunk for a summary set. `history` is every history message in chat order and `summaries` the set's
 * stored ones. The last `rawWindow` messages are never summarized. Over the rest:
 * 1. The FIRST invalid summary (in chat order) is re-planned over its covered messages that survive (and lie
 *    outside the raw window); one with none left is skipped. A re-plan may be shorter than `chunkSize`.
 * 2. Otherwise the first run of at least `chunkSize` consecutive messages that no valid summary covers gives a chunk
 *    of exactly `chunkSize` messages. In a healthy chat that is the messages right after the last covered one.
 * 3. Otherwise nothing, with the reason in plain language.
 * Chunk boundaries follow message ids, so deleting a message never shifts the chunks after it.
 */
export function planNextChunk<M extends SummaryMessage>(options: {
  history: readonly M[];
  summaries: readonly Summary[];
  chunkSize: number;
  rawWindow: number;
}): ChunkDecision<M> {
  const { history, summaries, chunkSize, rawWindow } = options;
  const eligible = history.slice(0, Math.max(0, history.length - rawWindow));
  if (!eligible.length)
    return {
      reason: `Nothing to summarize: the chat has ${plural(history.length, 'message')}, all within the last ${rawWindow} kept raw.`,
    };
  const byId = indexById(history);
  const position = new Map(eligible.map((message, index) => [message.id, index]));
  // Summaries in chat order, by their first covered message that is still eligible (those with none are skipped).
  const placed = summaries
    .flatMap((summary) => {
      const survivors = summary.messageIds.filter((id) => position.has(id));
      return survivors.length
        ? [{ summary, survivors, first: Math.min(...survivors.map((id) => position.get(id)!)) }]
        : [];
    })
    .sort((a, b) => a.first - b.first);
  const covered = new Set<string>();
  for (const { summary, survivors } of placed)
    if (summaryIsValid(summary, byId)) for (const id of survivors) covered.add(id);
  const stale = placed.find(({ summary }) => !summaryIsValid(summary, byId));
  if (stale) {
    const keep = new Set(stale.survivors);
    return {
      chunk: planOf(
        eligible.filter((message) => keep.has(message.id)),
        stale.summary.id,
      ),
    };
  }
  let run: M[] = [];
  let longest = 0;
  for (const message of [...eligible, undefined]) {
    if (message && !covered.has(message.id)) {
      run.push(message);
      continue;
    }
    if (run.length >= chunkSize) return { chunk: planOf(run.slice(0, chunkSize)) };
    longest = Math.max(longest, run.length);
    run = [];
  }
  if (!longest)
    return { reason: `Nothing to summarize: every message outside the last ${rawWindow} is already summarized.` };
  return {
    reason: `Nothing to summarize yet: ${plural(longest, 'message')} outside the last ${rawWindow} ${longest === 1 ? 'is' : 'are'} not summarized, and a chunk needs ${chunkSize}.`,
  };
}
