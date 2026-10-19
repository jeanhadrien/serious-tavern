import { alternativesOfLastTurn, type ChatMessage, type ExecutionLog } from '@st/shared';

/** One streamed fragment of a Chat Output: `runId` tells apart the runs of a reply list (absent: a single-run server). */
export type DeltaTarget = { nodeId: string; runId?: string; textDelta?: string; reasoningDelta?: string };

/**
 * Appends streamed text to the row of a Chat Output, creating its row on the first delta. A row is one Chat Output of
 * one run: workflows of a reply list may use the same node ids, so rows are keyed by `runId` and node id together.
 * Runs that stream at the same time start in any order, so a new row goes before the streaming rows of runs listed
 * below its own (`positions`: the runs' list positions, from `run.start`), which is where the settled turn puts them.
 */
export function applyDelta(
  messages: ChatMessage[],
  { nodeId, runId, textDelta = '', reasoningDelta = '' }: DeltaTarget,
  positions: ReadonlyMap<string, number> = new Map(),
  fresh: () => ChatMessage = () => ({
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    status: 'streaming',
    nodeId,
    ...(runId !== undefined && { runId }),
    createdAt: new Date().toISOString(),
  }),
): ChatMessage[] {
  const live = (message: ChatMessage) =>
    message.status === 'streaming' && message.nodeId === nodeId && message.runId === runId;
  const grow = (message: ChatMessage): ChatMessage => ({
    ...message,
    content: message.content + textDelta,
    ...(reasoningDelta ? { reasoning: (message.reasoning ?? '') + reasoningDelta } : {}),
  });
  if (messages.some(live)) return messages.map((m) => (live(m) ? grow(m) : m));
  const own = runId === undefined ? undefined : positions.get(runId);
  const later = messages.findIndex(
    (message) =>
      own !== undefined &&
      message.status === 'streaming' &&
      message.runId !== undefined &&
      (positions.get(message.runId) ?? -1) > own,
  );
  return later < 0
    ? [...messages, grow(fresh())]
    : [...messages.slice(0, later), grow(fresh()), ...messages.slice(later)];
}

/** The id of the execution log a message opens: its own run's (`runId`), else the turn's (older messages). */
export const messageLogId = (message: Pick<ChatMessage, 'runId' | 'executionId'>): string | undefined =>
  message.runId ?? message.executionId;

/**
 * Every log a settled turn brings: each run of the reply section (`executions`), or the one `execution` of a result from
 * before reply lists. On a failure `execution` is the failing run's, which `executions` lists too. None when no
 * workflow of the chat replies.
 */
export function resultLogs(result: { execution?: ExecutionLog; executions?: readonly ExecutionLog[] }): ExecutionLog[] {
  const all = result.executions ?? [];
  const { execution } = result;
  return !execution || all.some((log) => log.id === execution.id) ? [...all] : [...all, execution];
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
