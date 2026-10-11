import { canConnect, type CoercionKind, type PortDataType } from '@st/shared/ports';
import type { PromptMessage } from '@st/shared';

// Node templates/replies use compact JSON; port and preset text coercion uses pretty JSON.
export const stringify = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);

export function coerceValue(value: unknown, kind: CoercionKind): string {
  if (kind === 'messages-to-text') {
    if (!Array.isArray(value)) return stringify(value);
    return value.map((message: PromptMessage) => `${message.role}: ${message.content}`).join('\n');
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
