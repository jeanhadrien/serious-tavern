import type { ChatMessage } from '../models.js';
import { readTurnEntries, type TurnEntry } from './writes.js';

/** The part of a message that decides whether a turn is still in the chat. */
export type PresenceMessage = Pick<ChatMessage, 'role' | 'executionId' | 'status'>;

export type TurnPresence = {
  entry: TurnEntry;
  /** 1-based among the turns that are present, in stored order; null when the turn is not present. */
  turn: number | null;
};

/**
 * Which stored turns are still in the chat. A turn is present when any of its replies still exists (a reply
 * stopped halfway counts, a reply still streaming does not), or, for a turn that produced no reply, when it
 * completed. User messages never count: deleting a reply undoes its turn though the user message stays.
 * Present turns are numbered 1..n in stored order; the turn being run is n + 1.
 */
export function turnPresence(messages: readonly PresenceMessage[], entries: readonly TurnEntry[]): TurnPresence[] {
  const replied = new Set<string>();
  for (const message of messages)
    if (message.role === 'assistant' && message.status !== 'streaming' && message.executionId)
      replied.add(message.executionId);
  let number = 0;
  return entries.map((entry) => {
    const present = entry.replies > 0 ? replied.has(entry.executionId) : entry.completed;
    return { entry, turn: present ? ++number : null };
  });
}

/**
 * Whether a present turn of the session wrote the definition. Writes of turns whose replies are gone can
 * never come back, so they do not count (renaming or deleting a definition is only blocked by live data).
 */
export function sessionUsesDefinition(
  session: { messages: readonly PresenceMessage[]; state?: unknown },
  definitionId: string,
): boolean {
  return turnPresence(session.messages, readTurnEntries(session.state)).some(
    ({ entry, turn }) =>
      turn !== null &&
      entry.writes.some((write) => write.target.kind === 'definition' && write.target.definitionId === definitionId),
  );
}
