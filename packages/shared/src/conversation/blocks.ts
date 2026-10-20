import type { ConversationMessage } from './message.js';
import { callsOf, toolCallLine, toolResultLine } from './transcript.js';

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

/**
 * Turns the tool blocks that name a tool outside `declared` into plain text, for a backend that refuses a history
 * whose calls match no declared tool. A block can't be split, so one undeclared call flattens the whole block: the
 * assistant message keeps its content followed by the transcript lines of its calls (`messagesToText`'s format), and
 * the `tool` messages become one `user` message holding their transcript lines. Blocks whose calls are all declared are
 * untouched. `flattened` counts the calls turned into text, for a node log line. A flattened assistant message drops
 * its `provider_data` (it describes the calls that are gone) and keeps its reasoning. Meant for the final prompt,
 * never for stored data; run it before `repairToolSequence`.
 */
export function flattenUndeclaredToolBlocks(
  messages: readonly ConversationMessage[],
  declared: Iterable<string>,
): { messages: ConversationMessage[]; flattened: number } {
  const known = new Set(declared);
  const result: ConversationMessage[] = [];
  let flattened = 0;
  for (const block of messageBlocks(messages)) {
    const [first, ...answers] = block as [ConversationMessage, ...ConversationMessage[]];
    const calls = callsOf(first);
    if (calls.every((call) => known.has(call.function.name))) {
      result.push(...block);
      continue;
    }
    flattened += calls.length;
    const { tool_calls: _calls, provider_data: _providerData, ...assistant } = first;
    const toolNames = new Map(calls.map((call) => [call.id, call.function.name]));
    result.push({ ...assistant, content: [first.content, ...calls.map(toolCallLine)].filter(Boolean).join('\n') });
    if (answers.length > 0)
      result.push({ role: 'user', content: answers.map((answer) => toolResultLine(answer, toolNames)).join('\n') });
  }
  return { messages: result, flattened };
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
