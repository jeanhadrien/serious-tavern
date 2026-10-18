import type { HistoryPart } from '@st/shared';

/** Memory's text format: one `role: content` line per message. Next Chunk's `text` output uses it too. */
export const transcript = (messages: readonly { role: string; content: string }[]): string =>
  messages.map((message) => `${message.role}: ${message.content}`).join('\n');

/** The heading of a summary in Memory's `messages` format (a system message). */
const SUMMARY_HEADING = '[Summary of earlier messages]';

/** A summarized history as text: `role: content` lines, with `Summary: <text>` where a summary stands. */
export const partsToText = (parts: readonly HistoryPart[]): string =>
  parts
    .map((part) => (part.kind === 'summary' ? `Summary: ${part.summary.text}` : transcript([part.message])))
    .join('\n');

/** A summarized history as messages: the messages as they are, and each summary as one system message. */
export const partsToMessages = (parts: readonly HistoryPart[]) =>
  parts.map((part) =>
    part.kind === 'summary'
      ? { role: 'system' as const, content: `${SUMMARY_HEADING}\n${part.summary.text}` }
      : part.message,
  );
