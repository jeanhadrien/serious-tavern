/** Memory's text format: one `role: content` line per message. Next Chunk's `text` output uses it too. */
export const transcript = (messages: readonly { role: string; content: string }[]): string =>
  messages.map((message) => `${message.role}: ${message.content}`).join('\n');
