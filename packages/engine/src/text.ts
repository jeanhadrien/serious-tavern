import { canConnect, coerceValue, type PortDataType } from '@st/shared/ports';

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
