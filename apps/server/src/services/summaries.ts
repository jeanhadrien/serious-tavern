import type { ChatMessage, Session, SummaryWrite } from '@st/shared';
import { commitSummaryWrites } from '@st/shared';
import { now } from '../context.js';

/** Messages a turn may read as history. Streaming and partial rows never enter it. */
export function historyMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.status === undefined || message.status === 'final');
}

/**
 * Stores the summaries a run wrote into the session, against the chat as it is NOW (call it inside the session's
 * `update`, after the turn's own messages are in). A write whose messages changed since Next Chunk planned it, or that
 * overlaps a valid summary of its set, is dropped; the warnings say so and belong in the run's execution log. Summaries
 * are session data, not turn state: nothing here is tied to the turn's entry or undone with its replies. Returns the
 * warnings; the session is left untouched when nothing is stored.
 */
export function commitSummaries(current: Session, writes: readonly SummaryWrite[], executionId: string): string[] {
  if (!writes.length) return [];
  const { summaries, saved, warnings } = commitSummaryWrites(
    current.summaries,
    historyMessages(current.messages),
    writes,
    { executionId, createdAt: now() },
  );
  if (saved) current.summaries = summaries;
  return warnings;
}
