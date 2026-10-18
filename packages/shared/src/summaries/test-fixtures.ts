import { fingerprintMessages, type Summary, type SummaryMessage } from './summary.js';

/** Messages m1..mN alternating user/assistant, with content "text k". */
export const chat = (count: number): SummaryMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: `text ${index + 1}`,
  }));

/** A summary of the messages with these ids (taken from `history`), valid for that history. */
export function summaryOf(history: readonly SummaryMessage[], ids: string[], id = `s-${ids[0]}`): Summary {
  const covered = ids.map((messageId) => history.find((message) => message.id === messageId)!);
  return {
    id,
    messageIds: ids,
    fingerprint: fingerprintMessages(covered),
    text: `summary of ${ids.join(',')}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    executionId: 'e0',
  };
}

/** Ids m<from>..m<to>. */
export const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => `m${from + index}`);
