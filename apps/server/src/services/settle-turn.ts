import { randomUUID } from 'node:crypto';
import type { ChatMessage, Session, StateWrite, SummaryWrite } from '@st/shared';
import { SUMMARY_WARNING_LIMITS, withTurnEntry } from '@st/shared';
import type { ChatReply } from '@st/engine';
import { now } from '../context.js';
import { commitSummaries } from './summaries.js';
import type { StreamedRow } from './turn-stream.js';

export type Settlement = {
  executionId: string;
  userMessage?: ChatMessage;
  replies: ChatReply[];
  streamed: StreamedRow[];
  interrupted: boolean;
  // The story state writes of the nodes that completed; stored with the turn's entry.
  writes?: StateWrite[];
  // The summaries the nodes that completed asked to store. Committed against the chat as it is at settle time, and not
  // tied to the turn: deleting its replies later keeps them.
  summaryWrites?: SummaryWrite[];
  // The after-reply run this turn leaves behind: the entry says `running` from the moment it is saved, so the
  // run never has a gap in which the chat shows none.
  postExecutionId?: string;
};

/**
 * Writes the turn's assistant rows in one place. Replies are kept in engine order; a streamed row
 * that has a reply is promoted in place (same id). A streamed row without a reply is dropped when the
 * turn completed (the output was skipped), and kept as `partial` when the turn was interrupted.
 */
export function settleTurn(
  current: Session,
  {
    executionId,
    userMessage,
    replies,
    streamed,
    interrupted,
    writes = [],
    summaryWrites = [],
    postExecutionId,
  }: Settlement,
) {
  const streamedIds = new Set(streamed.map((row) => row.id));
  const streamedByOutput = new Map(streamed.map((row) => [row.outputId, row]));
  const repliedOutputs = new Set(replies.map((reply) => reply.nodeId));
  const replied = replies.map((reply): ChatMessage => {
    const live = streamedByOutput.get(reply.nodeId);
    return {
      id: live?.id ?? randomUUID(),
      role: 'assistant',
      content: reply.content,
      ...(reply.name === undefined ? {} : { name: reply.name }),
      ...(reply.characterId === undefined ? {} : { characterId: reply.characterId }),
      createdAt: live?.createdAt ?? now(),
      executionId,
      ...(live ? { nodeId: live.outputId, status: 'final' as const } : {}),
      ...(live?.reasoning ? { reasoning: live.reasoning } : {}),
    };
  });
  const partial = interrupted
    ? streamed
        .filter((row) => !repliedOutputs.has(row.outputId))
        .map(
          (row): ChatMessage => ({
            id: row.id,
            role: 'assistant',
            content: row.content,
            ...(row.name === undefined ? {} : { name: row.name }),
            ...(row.characterId === undefined ? {} : { characterId: row.characterId }),
            createdAt: row.createdAt,
            executionId,
            nodeId: row.outputId,
            status: 'partial',
            ...(row.reasoning ? { reasoning: row.reasoning } : {}),
          }),
        )
    : [];
  const assistantMessages = [...replied, ...partial];
  current.messages = current.messages.filter((message) => !streamedIds.has(message.id));
  const saved = userMessage && (current.messages.find((message) => message.id === userMessage.id) ?? userMessage);
  if (saved) saved.executionId = executionId;
  current.messages.push(...assistantMessages);
  const summaryWarnings = commitSummaries(current, summaryWrites, executionId);
  // Every settled turn leaves an entry, with or without writes, so turn counting is stable. Whether it still
  // counts later depends on its replies (see `turnPresence`); `completed` is "ran to the end, no error or stop".
  current.state = withTurnEntry(current.state, {
    executionId,
    at: now(),
    completed: !interrupted,
    replies: assistantMessages.length,
    writes,
    ...(summaryWarnings.length && {
      summaryWarnings: summaryWarnings
        .map((text) => text.slice(0, SUMMARY_WARNING_LIMITS.length))
        .slice(-SUMMARY_WARNING_LIMITS.count),
    }),
    ...(postExecutionId ? { postExecutionId, postStatus: 'running' as const } : {}),
  });
  current.updatedAt = now();
  return { userMessage: saved, assistantMessages, summaryWarnings };
}
