export const portDataTypes = ['text', 'number', 'boolean', 'object', 'array', 'messages', 'character', 'any'] as const;
export type PortDataType = (typeof portDataTypes)[number];
export type PortDef = {
  name: string;
  label: string;
  dataType: PortDataType;
  description?: string;
  required?: boolean;
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
