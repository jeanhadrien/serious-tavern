import { isPlainObject, isSettingKey, parseDecimal, TEMPLATE_NAME_RULE } from '@st/shared';

// Text <-> value helpers of the key editor. Every field is typed as text in the form and turned into a value only
// when the draft is compiled, so a half-typed number never loses what the user typed.

export type FieldType = 'text' | 'number' | 'boolean';
const FIELD_TYPES: readonly string[] = ['text', 'number', 'boolean'];

export const numberText = (value?: number): string => (value === undefined ? '' : String(value));

/** Blank means "not set"; anything that is not a plain decimal number is rejected. */
export function parseNumberText(text: string): { ok: true; value?: number } | { ok: false } {
  if (!text.trim()) return { ok: true };
  const value = parseDecimal(text);
  return value === undefined ? { ok: false } : { ok: true, value };
}

/** One option per line. */
export const optionsText = (options: readonly string[]): string => options.join('\n');

export const parseOptions = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** One `name:type` per line. */
export const fieldsText = (fields?: Record<string, FieldType>): string =>
  fields
    ? Object.entries(fields)
        .map(([name, type]) => `${name}:${type}`)
        .join('\n')
    : '';

/** Blank text means no declared fields. Problems name the line, counted as the user sees them. */
export function parseFields(
  text: string,
): { ok: true; fields?: Record<string, FieldType> } | { ok: false; errors: string[] } {
  const fields: Record<string, FieldType> = {};
  const errors: string[] = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    const entry = line.trim();
    if (!entry) continue;
    const colon = entry.lastIndexOf(':');
    const name = colon < 0 ? entry : entry.slice(0, colon).trim();
    const type = colon < 0 ? '' : entry.slice(colon + 1).trim();
    const problem = (() => {
      if (!name || !FIELD_TYPES.includes(type)) return 'write name:type, with type text, number or boolean';
      if (!isSettingKey(name)) return `"${name}" is not a usable field name. ${TEMPLATE_NAME_RULE}`;
      if (Object.hasOwn(fields, name)) return `"${name}" is listed twice`;
      fields[name] = type as FieldType;
      return undefined;
    })();
    if (problem) errors.push(`Line ${index + 1}: ${problem}`);
  }
  if (errors.length) return { ok: false, errors };
  return Object.keys(fields).length ? { ok: true, fields } : { ok: true };
}

/** An object as pretty JSON; undefined is blank. */
export const objectText = (value?: Record<string, unknown>): string =>
  value === undefined ? '' : JSON.stringify(value, null, 2);

/** Blank means none; anything but a JSON object is rejected. */
export function parseObjectText(
  text: string,
): { ok: true; value?: Record<string, unknown> } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `Not valid JSON (${(error as Error).message})` };
  }
  if (!isPlainObject(value)) return { ok: false, error: 'Must be a JSON object, like {"a": 1}' };
  return { ok: true, value };
}
