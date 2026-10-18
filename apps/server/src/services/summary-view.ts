import {
  indexById,
  readSummaries,
  summaryIsValid,
  type ChatMessage,
  type SummarySetView,
  type SummaryView,
} from '@st/shared';
import { historyMessages } from './summaries.js';

/**
 * The chat's stored summaries for the web: per set (stored order), each summary in chat order with whether it is
 * still valid, how many of its messages are gone, and where the ones that are left stand. Computed on read from the
 * chat as it is; nothing is stored.
 */
export function summaryViews(rawSummaries: unknown, messages: ChatMessage[]): SummarySetView[] {
  const history = historyMessages(messages);
  const byId = indexById(history);
  const position = new Map(history.map((message, index) => [message.id, index + 1]));
  return Object.entries(readSummaries(rawSummaries)).map(([set, summaries]) => ({
    set,
    summaries: summaries
      .map((summary): SummaryView => {
        const left = summary.messageIds.filter((id) => position.has(id));
        const first = left.reduce<string | undefined>(
          (best, id) => (best === undefined || position.get(id)! < position.get(best)! ? id : best),
          undefined,
        );
        const last = left.reduce<string | undefined>(
          (best, id) => (best === undefined || position.get(id)! > position.get(best)! ? id : best),
          undefined,
        );
        return {
          id: summary.id,
          text: summary.text,
          createdAt: summary.createdAt,
          executionId: summary.executionId,
          valid: summaryIsValid(summary, byId),
          covered: summary.messageIds.length,
          missing: summary.messageIds.length - left.length,
          ...(first === undefined || last === undefined
            ? {}
            : {
                firstIndex: position.get(first)!,
                lastIndex: position.get(last)!,
                firstMessageId: first,
                lastMessageId: last,
              }),
        };
      })
      .sort((a, b) => (a.firstIndex ?? Infinity) - (b.firstIndex ?? Infinity)),
  }));
}
