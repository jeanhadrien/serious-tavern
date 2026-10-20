import type { ConversationMessage, ToolCall } from './message.js';

/** How a tool call reads in a transcript. */
export const toolCallLine = (call: ToolCall): string =>
  `assistant -> ${call.function.name}(${call.function.arguments})`;

/** How a tool result reads in a transcript: `tool <name>: <content>`, or `tool: ...` when its call is unknown. */
export function toolResultLine(message: ConversationMessage, toolNames: ReadonlyMap<string, string>): string {
  const name = message.tool_call_id ? toolNames.get(message.tool_call_id) : undefined;
  return `${name ? `tool ${name}` : 'tool'}: ${message.content}`;
}

/** The calls of an assistant message (none for any other role). */
export const callsOf = (message: ConversationMessage): ToolCall[] =>
  message.role === 'assistant' && Array.isArray(message.tool_calls) ? message.tool_calls : [];

/**
 * A transcript, one line per message. An assistant message lists its tool calls after its text, and a tool
 * message names the tool whose call it answers (looked up among the earlier messages).
 */
export function messagesToText(messages: readonly ConversationMessage[]): string {
  const toolNames = new Map<string, string>();
  const lines: string[] = [];
  for (const message of messages) {
    const calls = callsOf(message);
    for (const call of calls) toolNames.set(call.id, call.function.name);
    lines.push(message.role === 'tool' ? toolResultLine(message, toolNames) : `${message.role}: ${message.content}`);
    for (const call of calls) lines.push(toolCallLine(call));
  }
  return lines.join('\n');
}
