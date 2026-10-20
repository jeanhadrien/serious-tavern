import { canConnect, type CoercionKind, type PortDataType } from '@st/shared/ports';
import type { PromptMessage } from '@st/shared';

// Node templates/replies use compact JSON; port and preset text coercion uses pretty JSON.
export const stringify = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);

// A transcript, one line per message. An assistant message lists its tool calls after its text, and a tool
// message names the tool whose call it answers (looked up among the earlier messages).
function messagesToText(messages: PromptMessage[]): string {
  const toolNames = new Map<string, string>();
  const lines: string[] = [];
  for (const message of messages) {
    const calls = message.role === 'assistant' && Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const call of calls) toolNames.set(call.id, call.function.name);
    const toolName = message.role === 'tool' && message.tool_call_id ? toolNames.get(message.tool_call_id) : undefined;
    lines.push(`${toolName ? `tool ${toolName}` : message.role}: ${message.content}`);
    for (const call of calls) lines.push(`assistant -> ${call.function.name}(${call.function.arguments})`);
  }
  return lines.join('\n');
}

export function coerceValue(value: unknown, kind: CoercionKind): string {
  if (kind === 'messages-to-text') {
    if (!Array.isArray(value)) return stringify(value);
    return messagesToText(value);
  }
  if (value != null && typeof value === 'object') return JSON.stringify(value, null, 2);
  return value == null ? '' : String(value);
}

function sourceType(value: unknown): PortDataType {
  if (
    Array.isArray(value) &&
    value.every(
      (item) => item && typeof item === 'object' && typeof item.role === 'string' && typeof item.content === 'string',
    )
  )
    return 'messages';
  if (value === null || value === undefined) return 'text';
  if (typeof value === 'object') return Array.isArray(value) ? 'array' : 'object';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'text';
}

// Preset text conversion: message lists become transcripts, objects and arrays pretty JSON.
export function toText(value: unknown): string {
  if (value == null) return '';
  const compatibility = canConnect(sourceType(value), 'text');
  if (!compatibility.ok) throw new Error(compatibility.reason);
  return coerceValue(value, compatibility.coerce ?? 'to-text');
}

/** Plain-language kind of a value for error messages: "text", "a number", "an object", "true", "null"... */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number')
    return Number.isNaN(value) ? 'NaN (not a number)' : Number.isFinite(value) ? 'a number' : 'an infinite number';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return 'an object';
  return typeof value;
}
