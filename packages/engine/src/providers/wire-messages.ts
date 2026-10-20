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

/** The request's tool fields (`tools`, `tool_choice`, `parallel_tool_calls`), each only when set. */
export function toolParams(request: ChatRequest) {
  return {
    ...(request.tools?.length ? { tools: request.tools } : {}),
    ...(request.toolChoice === undefined ? {} : { tool_choice: request.toolChoice }),
    ...(request.parallelToolCalls === undefined ? {} : { parallel_tool_calls: request.parallelToolCalls }),
  };
}
