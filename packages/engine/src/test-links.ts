import { fingerprintMessages, type ChatMessage, type StateDefinition } from '@st/shared';

// Fixtures for the tests of nodes that work with message links.

export const MEMORY_ID = '22222222-2222-4222-8222-222222222222';

/** A `memory` definition with an uncapped `summaries` collection, a `facts` collection and a plain text key. */
export const memoryDefinition: StateDefinition = {
  id: MEMORY_ID,
  name: 'memory',
  keys: {
    summaries: { type: 'collection' },
    facts: { type: 'collection', fields: { kind: 'text' } },
    note: { type: 'text' },
  },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

/** Messages m1..mN alternating user/assistant with content "text k". */
export const messagesOf = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `text ${index + 1}`,
    createdAt: '',
  }));

export const idRange = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => `m${from + index}`);

/** An item `id` linked to the messages with these ids, intact for `history`. */
export function linkedItem(history: readonly ChatMessage[], ids: string[], id = `s-${ids[0]}`) {
  const covered = ids.map((messageId) => history.find((message) => message.id === messageId)!);
  return {
    id,
    text: `summary of ${ids[0]}-${ids.at(-1)}`,
    messages: { ids, fingerprint: fingerprintMessages(covered) },
  };
}

/** `history` with message `id` edited, or deleted when `content` is undefined. */
export const withEdit = (history: readonly ChatMessage[], id: string, content?: string): ChatMessage[] =>
  history.flatMap((message) =>
    message.id !== id ? [message] : content === undefined ? [] : [{ ...message, content }],
  );
