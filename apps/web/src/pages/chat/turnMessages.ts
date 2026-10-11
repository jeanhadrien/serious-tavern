import type { ChatMessage } from '@st/shared';

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
 * Replaces the turn's local rows (the optimistic user message and every live streaming row) with what
 * the server settled: the saved user message and the final or partial assistant messages.
 */
export function settleTurn(
  messages: ChatMessage[],
  optimisticId: string,
  saved: { userMessage: ChatMessage; assistantMessages: ChatMessage[] },
): ChatMessage[] {
  const kept = messages.filter((message) => message.id !== optimisticId && message.status !== 'streaming');
  return [...kept, saved.userMessage, ...saved.assistantMessages];
}
