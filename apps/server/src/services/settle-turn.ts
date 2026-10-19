import { randomUUID } from 'node:crypto';
import type { ChatMessage, Session, StateDefinition, StateWrite } from '@st/shared';
import { activeMessages, LINK_WARNING_LIMITS, withTurnEntry } from '@st/shared';
import type { ChatReply } from '@st/engine';
import { now } from '../context.js';
import { commitLinks } from './links.js';
import type { StreamedRow } from './turn-stream.js';

/**
 * Messages a turn may read as history: the active ones (the replies of alternatives that aren't shown are not in the
 * chat), and never streaming or partial rows. EVERY server reader of "the chat" goes through this.
 */
export function historyMessages(messages: ChatMessage[]): ChatMessage[] {
  return activeMessages(messages).filter((message) => message.status === undefined || message.status === 'final');
}

export type Settlement = {
  executionId: string;
  userMessage?: ChatMessage;
  replies: ChatReply[];
  streamed: StreamedRow[];
  interrupted: boolean;
  // The story state writes of the nodes that completed; stored with the turn's entry. A write that links messages is
  // checked against the chat as it is at settle time (`commitLinks`); `definitions` name its key in the warnings.
  writes?: StateWrite[];
  definitions?: readonly StateDefinition[];
  // The after-reply run this turn leaves behind: the entry says `running` from the moment it is saved, so the
  // run never has a gap in which the chat shows none.
  postExecutionId?: string;
  // Set when the turn is a regenerate of the last turn (`rootId`: the `executionId` of its first alternative). Its
  // replies join that turn's alternatives and, if there are any, replace the shown ones in this same write.
  regenerate?: { rootId: string };
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
    definitions = [],
    postExecutionId,
    regenerate,
  }: Settlement,
) {
  const alternativeOf = regenerate ? { alternativeOf: regenerate.rootId } : {};
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
      ...alternativeOf,
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
            ...alternativeOf,
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
  // A regenerate that produced a reply row shows it: the previous alternatives of the turn go inactive in the same
  // write. One that produced none leaves the messages as they are.
  if (regenerate && assistantMessages.length) deactivateAlternatives(current.messages, regenerate.rootId);
  current.messages.push(...assistantMessages);
  // A write that links messages is judged against the chat as it is now, the turn's own messages included.
  const committed = commitLinks(historyMessages(current.messages), writes, definitions);
  // Every settled turn leaves an entry, with or without writes, so turn counting is stable. Whether it still
  // counts later depends on its replies (see `turnPresence`); `completed` is "ran to the end, no error or stop".
  current.state = withTurnEntry(current.state, {
    executionId,
    at: now(),
    // A regenerate with no reply row leaves the shown alternative in place, so its entry must not count as a turn of its
    // own (a turn without replies counts when it completed): it is recorded as not completed.
    completed: !interrupted && !(regenerate && !assistantMessages.length),
    replies: assistantMessages.length,
    writes: committed.writes,
    ...(committed.warnings.length && {
      linkWarnings: committed.warnings
        .map((text) => text.slice(0, LINK_WARNING_LIMITS.length))
        .slice(-LINK_WARNING_LIMITS.count),
    }),
    ...(postExecutionId ? { postExecutionId, postStatus: 'running' as const } : {}),
  });
  current.updatedAt = now();
  return { userMessage: saved, assistantMessages, linkWarnings: committed.warnings };
}

// Every settled reply of the turn's alternatives (the root's and the regenerated ones) stops being shown.
function deactivateAlternatives(messages: ChatMessage[], rootId: string) {
  for (const message of messages) {
    const inGroup = message.executionId === rootId || message.alternativeOf === rootId;
    if (inGroup && message.role === 'assistant' && message.status !== 'streaming') message.inactive = true;
  }
}
