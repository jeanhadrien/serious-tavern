import { analyzeLinks, type LinkableItem } from './analyze.js';
import { fingerprintMessages, type LinkMessage } from './fingerprint.js';

/** The next chunk to link: its messages, their fingerprint, and the broken item it re-plans, if any. */
export type ChunkPlan<M extends LinkMessage = LinkMessage> = {
  messageIds: string[];
  messages: M[];
  fingerprint: string;
  /** The id of the broken item this chunk is for. */
  replaces?: string;
};

export type ChunkDecision<M extends LinkMessage = LinkMessage> =
  | { chunk: ChunkPlan<M>; reason?: undefined }
  | { chunk?: undefined; reason: string };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function planOf<M extends LinkMessage>(messages: M[], replaces?: string): ChunkPlan<M> {
  return {
    messageIds: messages.map((message) => message.id),
    messages,
    fingerprint: fingerprintMessages(messages),
    ...(replaces === undefined ? {} : { replaces }),
  };
}

/**
 * Plans one chunk of messages that a collection key does not cover yet. `history` is every history message in chat
 * order and `items` the key's items (those without a link are ignored). A message is covered when an intact item links
 * it. The last `rawWindow` messages are never planned. Over the rest:
 * 1. The FIRST item (in chat order) that is not intact and not replaced is re-planned over its surviving messages that
 *    no intact item covers; one with none left (or none outside the raw window) is skipped. A re-plan may be shorter
 *    than `chunkSize`, and `replaces` is the item's id.
 * 2. Otherwise the first run of at least `chunkSize` consecutive uncovered messages gives a chunk of exactly
 *    `chunkSize` messages. In a healthy chat that is the messages right after the last covered one.
 * 3. Otherwise nothing, with the reason in plain language.
 * Chunk boundaries follow message ids, so deleting a message never shifts the chunks after it.
 */
export function planNextChunk<M extends LinkMessage>(options: {
  history: readonly M[];
  items: readonly LinkableItem[];
  chunkSize: number;
  rawWindow: number;
}): ChunkDecision<M> {
  const { history, items, chunkSize, rawWindow } = options;
  const eligible = history.slice(0, Math.max(0, history.length - rawWindow));
  if (!eligible.length)
    return {
      reason: `Nothing to link: the chat has ${plural(history.length, 'message')}, all within the last ${rawWindow} kept raw.`,
    };
  const position = new Map(eligible.map((message, index) => [message.id, index]));
  const entries = analyzeLinks(items, history);
  const covered = new Set(entries.filter(({ status }) => status === 'intact').flatMap(({ link }) => link.ids));
  const broken = entries
    .filter(({ status, replaced }) => status !== 'intact' && !replaced)
    .map((entry) => ({ entry, mine: entry.survivors.filter((id) => position.has(id) && !covered.has(id)) }))
    .filter(({ mine }) => mine.length > 0)
    .sort(
      (a, b) => Math.min(...a.mine.map((id) => position.get(id)!)) - Math.min(...b.mine.map((id) => position.get(id)!)),
    );
  const stale = broken[0];
  if (stale) {
    const keep = new Set(stale.mine);
    return {
      chunk: planOf(
        eligible.filter((message) => keep.has(message.id)),
        stale.entry.item.id,
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
    return {
      reason: `Nothing to link: every message outside the last ${rawWindow} is already linked by an intact item.`,
    };
  return {
    reason: `Nothing to link yet: ${plural(longest, 'message')} outside the last ${rawWindow} ${longest === 1 ? 'is' : 'are'} not linked, and a chunk needs ${chunkSize}.`,
  };
}
