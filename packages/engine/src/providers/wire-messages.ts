import type { PromptMessage } from '@st/shared';
import type { ChatRequest } from './index.js';
import type { WireSettings } from './wire-settings.js';

/**
 * One canonical message as the backend receives it. Tool calls go verbatim; an assistant message that only
 * calls tools has `content: null`; `provider_data` (the record's replay fields) is spread in, and `reasoning`
 * goes under the record's `reasoningReplayField` when it has one. `provenance` and other app-only fields are
 * never sent.
 */
export function wireMessage(message: PromptMessage, { messageName, reasoningReplayField }: WireSettings) {
  const calls = message.tool_calls?.length ? message.tool_calls : undefined;
  return {
    // First, so the standard fields below always win.
    ...message.provider_data,
    role: message.role,
    content: calls && message.content === '' ? null : message.content,
    // An empty name still counts as set.
    ...(messageName === null || message.name === undefined ? {} : { [messageName]: message.name }),
    ...(calls ? { tool_calls: calls } : {}),
    ...(message.tool_call_id === undefined ? {} : { tool_call_id: message.tool_call_id }),
    ...(reasoningReplayField && message.reasoning ? { [reasoningReplayField]: message.reasoning } : {}),
  };
}

/**
 * Joins consecutive assistant messages into one, with a blank line between their texts. Only plain neighbours merge:
 * never a message with tool calls (a block stays whole), never two with different `name`s, and never a message with
 * `provider_data` (merging would lose data the backend needs back). Reasoning is joined the same way, so two thoughts
 * become one; the first message's other fields (`provenance`) are kept. Applied to the request only, so the wire log
 * shows what was sent and stored data is untouched.
 */
export function mergeAssistantMessages(messages: readonly PromptMessage[]): PromptMessage[] {
  const mergeable = (message: PromptMessage) =>
    message.role === 'assistant' && !message.tool_calls?.length && message.provider_data === undefined;
  const join = (first: string | undefined, second: string | undefined) => [first, second].filter(Boolean).join('\n\n');
  const result: PromptMessage[] = [];
  for (const message of messages) {
    const previous = result.at(-1);
    if (previous && mergeable(previous) && mergeable(message) && previous.name === message.name) {
      const reasoning = join(previous.reasoning, message.reasoning);
      result[result.length - 1] = {
        ...previous,
        content: join(previous.content, message.content),
        ...(reasoning ? { reasoning } : {}),
      };
    } else result.push(message);
  }
  return result;
}

/** The request's tool fields (`tools`, `tool_choice`, `parallel_tool_calls`), each only when set. */
export function toolParams(request: ChatRequest) {
  return {
    ...(request.tools?.length ? { tools: request.tools } : {}),
    ...(request.toolChoice === undefined ? {} : { tool_choice: request.toolChoice }),
    ...(request.parallelToolCalls === undefined ? {} : { parallel_tool_calls: request.parallelToolCalls }),
  };
}
