import { messagesToText } from './conversation/transcript.js';

export const portDataTypes = ['text', 'number', 'boolean', 'object', 'array', 'messages', 'character', 'any'] as const;
export type PortDataType = (typeof portDataTypes)[number];
export type PortDef = {
  name: string;
  label: string;
  dataType: PortDataType;
  description?: string;
  required?: boolean;
  // Input only: when connected, a skipped source (or one that didn't produce the port) skips the node, as for a
  // required input; unlike `required`, the input may be left unconnected.
  requiredIfConnected?: boolean;
  // Input only: never makes the node skip. An inactive edge into it (skipped source, port not produced) only
  // leaves the input absent, even when it is the node's only connection (Recall's extra `text`).
  neverSkips?: boolean;
  optional?: boolean;
};
export type CoercionKind = 'to-text' | 'messages-to-text';
export type ConnectionResult = { ok: true; coerce?: CoercionKind } | { ok: false; reason: string };

/*
 * From                         | To               | Behavior
 * same type                    | same type        | pass through
 * any (on either side)         | any type         | pass through; runtime value is unknown
 * number/boolean/object/array  | text             | stringify (pretty JSON for object/array)
 * messages                     | text             | role: content transcript
 * messages                     | array            | pass through (messages are an array)
 * character                    | object           | pass through (characters are objects)
 * all other combinations       | differing type   | reject; no unsafe parsing or implicit narrowing
 */
export function canConnect(from: PortDataType | PortDef, to: PortDataType | PortDef): ConnectionResult {
  const source = typeof from === 'string' ? from : from.dataType;
  const target = typeof to === 'string' ? to : to.dataType;
  if (
    source === target ||
    source === 'any' ||
    target === 'any' ||
    (source === 'messages' && target === 'array') ||
    (source === 'character' && target === 'object')
  )
    return { ok: true };
  if (target === 'text' && source !== 'character')
    return { ok: true, coerce: source === 'messages' ? 'messages-to-text' : 'to-text' };
  return {
    ok: false,
    reason: `Cannot connect ${source} to ${target}; add a conversion node or choose a compatible port`,
  };
}

/** A value as text for a template or a reply: strings as they are, nothing as '', anything else as compact JSON. */
export const stringify = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);

/**
 * Converts a value for a connection `canConnect` marked as coercing. Node templates and replies use compact JSON
 * (`stringify`); port text coercion uses pretty JSON, and a message list becomes a `role: content` transcript. The one
 * home of the conversion: the executor applies it at run time, and the editor can show what an input received.
 */
export function coerceValue(value: unknown, kind: CoercionKind): string {
  if (kind === 'messages-to-text') {
    if (!Array.isArray(value)) return stringify(value);
    return messagesToText(value);
  }
  if (value != null && typeof value === 'object') return JSON.stringify(value, null, 2);
  return value == null ? '' : String(value);
}
