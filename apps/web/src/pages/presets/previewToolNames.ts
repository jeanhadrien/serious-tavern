import { callsOf, type PromptMessage } from '@st/shared';

/**
 * For each message, the name of the tool a `tool` message answers: the call must come earlier in the list.
 * `undefined` for any other message, and for a result whose call is not earlier (the row shows its `tool_call_id`).
 */
export function previewToolNames(messages: readonly PromptMessage[]): (string | undefined)[] {
  const names = new Map<string, string>();
  return messages.map((message) => {
    for (const call of callsOf(message)) names.set(call.id, call.function.name);
    return message.role === 'tool' && message.tool_call_id ? names.get(message.tool_call_id) : undefined;
  });
}

/** Tool call arguments for display: pretty-printed when they are a JSON object or array, the raw text otherwise. */
export function displayArguments(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? JSON.stringify(parsed, null, 2) : raw;
  } catch {
    return raw;
  }
}
