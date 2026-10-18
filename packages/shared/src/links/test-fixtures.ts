import { fingerprintMessages, type LinkMessage } from './fingerprint.js';
import type { ItemLink } from '../state/writes.js';

/** Messages m1..mN alternating user/assistant, with content "text k". */
export const chat = (count: number): LinkMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `text ${index + 1}`,
  }));

/** Ids m<from>..m<to>. */
export const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => `m${from + index}`);

/** A link to the messages with these ids (taken from `history`), intact for that history. */
export function linkTo(history: readonly LinkMessage[], ids: string[]): ItemLink {
  const covered = ids.map((id) => history.find((message) => message.id === id)!);
  return { ids, fingerprint: fingerprintMessages(covered) };
}

/** An item `s<first id>` (unless `id` is given) linked to the messages with these ids. */
export const linkedItem = (history: readonly LinkMessage[], ids: string[], id = `s-${ids[0]}`) => ({
  id,
  text: `summary of ${ids.join(',')}`,
  messages: linkTo(history, ids),
});

/** `history` with the message `id` edited (a new content), or deleted when `content` is undefined. */
export const withEdit = (history: readonly LinkMessage[], id: string, content?: string): LinkMessage[] =>
  history.flatMap((message) =>
    message.id !== id ? [message] : content === undefined ? [] : [{ ...message, content }],
  );
