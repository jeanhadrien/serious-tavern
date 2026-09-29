import type { CoercionKind } from '@st/shared/ports';
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
