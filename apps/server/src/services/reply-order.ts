import type { ChatMessage } from '@st/shared';

/**
 * Where the replies of the run at `position` go among the messages: replies are stored in LIST order, whichever run
 * finishes (or streams) first. That is before the first reply of this turn that a run listed below it wrote (settled or
 * still streaming), else at the end. `runOrder` is the execution ids of the turn's runs in list order; a reply whose run is
 * not in it (older data) counts as listed above everything. The user message and earlier turns are never after it.
 */
export function replyIndex(
  messages: readonly ChatMessage[],
  turnId: string,
  runOrder: readonly string[],
  position: number,
): number {
  const at = messages.findIndex(
    (message) =>
      message.role === 'assistant' &&
      message.executionId === turnId &&
      message.runId !== undefined &&
      runOrder.indexOf(message.runId) > position,
  );
  return at < 0 ? messages.length : at;
}
