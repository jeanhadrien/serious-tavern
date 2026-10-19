import { alternativesOfLastTurn, type ChatMessage } from '@st/shared';

/** Appends streamed text to the row of a Chat Output, creating its row on the first delta. */
export function applyDelta(
  messages: ChatMessage[],
  nodeId: string,
  textDelta = '',
  reasoningDelta = '',
  fresh: () => ChatMessage = () => ({
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    status: 'streaming',
    nodeId,
    createdAt: new Date().toISOString(),
  }),
): ChatMessage[] {
  const live = (message: ChatMessage) => message.status === 'streaming' && message.nodeId === nodeId;
  const grow = (message: ChatMessage): ChatMessage => ({
    ...message,
    content: message.content + textDelta,
    ...(reasoningDelta ? { reasoning: (message.reasoning ?? '') + reasoningDelta } : {}),
  });
  return messages.some(live) ? messages.map((m) => (live(m) ? grow(m) : m)) : [...messages, grow(fresh())];
}

/**
 * Replaces the turn's local rows (the optimistic user message, if any, and every live streaming row) with
 * what the server settled: the saved user message (absent for an empty send) and the final or partial
 * assistant messages.
 */
export function settleTurn(
  messages: ChatMessage[],
  optimisticId: string | undefined,
  saved: { userMessage?: ChatMessage; assistantMessages: ChatMessage[] },
): ChatMessage[] {
  const kept = messages.filter((message) => message.id !== optimisticId && message.status !== 'streaming');
  return [...kept, ...(saved.userMessage ? [saved.userMessage] : []), ...saved.assistantMessages];
}

/** The ids of the last turn's shown replies (what a regenerate replaces); empty when there is no last turn. */
export function lastTurnReplyIds(messages: readonly ChatMessage[]): string[] {
  const last = alternativesOfLastTurn(messages);
  return last?.alternatives.find((alternative) => alternative.executionId === last.activeExecutionId)?.messageIds ?? [];
}

/**
 * Replaces the last turn's shown replies while a regenerate streams: they are marked `inactive` locally, which is
 * what the server's settle does too, so the thread shows only the new rows. `settleRegenerate` shows them again
 * when the run leaves no reply.
 */
export function replaceLastTurnReplies(messages: ChatMessage[], hidden: readonly string[]): ChatMessage[] {
  const ids = new Set(hidden);
  return ids.size
    ? messages.map((message) => (ids.has(message.id) ? { ...message, inactive: true as const } : message))
    : messages;
}

/**
 * Settles a regenerate: the live rows give way to what the server saved. With at least one reply row the hidden
 * replies are inactive (whether or not the run had started) and the new alternative (which carries `alternativeOf`) is the shown one. With none the
 * server changed nothing, so the hidden replies are shown again.
 */
export function settleRegenerate(
  messages: ChatMessage[],
  hidden: readonly string[],
  saved: { assistantMessages: ChatMessage[] },
): ChatMessage[] {
  const kept = messages.filter((message) => message.status !== 'streaming');
  if (saved.assistantMessages.length) return [...replaceLastTurnReplies(kept, hidden), ...saved.assistantMessages];
  const ids = new Set(hidden);
  return kept.map((message) => {
    if (!ids.has(message.id)) return message;
    const { inactive: _hidden, ...shown } = message;
    return shown;
  });
}
