import type { ConversationMessage } from './message.js';

/**
 * Splits a list into blocks, the units a prompt must never split: an assistant message with `tool_calls`
 * together with the `tool` messages directly after it that answer one of its calls, or a single message.
 */
export function messageBlocks(messages: readonly ConversationMessage[]): ConversationMessage[][] {
  const blocks: ConversationMessage[][] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index] as ConversationMessage;
    const callIds = new Set((message.role === 'assistant' ? (message.tool_calls ?? []) : []).map((call) => call.id));
    const block = [message];
    index += 1;
    while (callIds.size > 0 && index < messages.length) {
      const next = messages[index] as ConversationMessage;
      if (next.role !== 'tool' || !next.tool_call_id || !callIds.has(next.tool_call_id)) break;
      block.push(next);
      index += 1;
    }
    blocks.push(block);
  }
  return blocks;
}

/** A copy of an assistant message without its tool calls. */
function withoutCalls(message: ConversationMessage): ConversationMessage {
  const { tool_calls: _calls, ...rest } = message;
  return rest;
}

/**
 * Makes a list every backend accepts. A `tool` message that answers no call of the assistant message
 * right before it (or answers one a second time) is dropped; an assistant message keeps its content but
 * loses the calls nobody answered, and is dropped when nothing is left. `dropped` counts the removed
 * messages plus the calls removed from kept messages, for a node log line. Meant for the final prompt,
 * never for stored data.
 */
export function repairToolSequence(messages: readonly ConversationMessage[]): {
  messages: ConversationMessage[];
  dropped: number;
} {
  const repaired: ConversationMessage[] = [];
  let dropped = 0;
  for (const [first, ...answers] of messageBlocks(messages)) {
    const message = first as ConversationMessage;
    if (message.role === 'tool') {
      dropped += 1;
    } else if (!message.tool_calls?.length) {
      // No calls (an empty list is not accepted by every backend either).
      repaired.push(message.tool_calls ? withoutCalls(message) : message);
    } else {
      const answered = new Set<string>();
      const kept = answers.filter((answer) => {
        const fresh = !answered.has(answer.tool_call_id as string);
        answered.add(answer.tool_call_id as string);
        if (!fresh) dropped += 1;
        return fresh;
      });
      const calls = message.tool_calls.filter((call) => answered.has(call.id));
      if (calls.length === message.tool_calls.length) repaired.push(message, ...kept);
      else if (calls.length > 0) {
        dropped += message.tool_calls.length - calls.length;
        repaired.push({ ...message, tool_calls: calls }, ...kept);
      } else if (message.content !== '') {
        dropped += message.tool_calls.length;
        repaired.push(withoutCalls(message));
      } else dropped += 1;
    }
  }
  return { messages: repaired, dropped };
}
