/** Collapses runs of whitespace to single spaces and cuts the text to `max` characters, ending with an ellipsis. */
export function shortText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…` : flat;
}

/**
 * A stored value in plain words: numbers and booleans as they are, text as itself (`(empty)` when blank), nothing
 * as `none`, and an object or list as compact JSON cut at 60 characters.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'string') return value.trim() ? value : '(empty)';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return shortText(JSON.stringify(value) ?? 'none', 60);
  } catch {
    return 'none';
  }
}

/** `text` in single quotes, whitespace collapsed and cut to `max` characters (the quotes not counted). */
export function quote(text: string, max: number): string {
  return `'${shortText(text, max)}'`;
}

/** A stored value in full, for a tooltip: text as itself, an object or list as indented JSON. */
export function fullText(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value !== 'object') return formatValue(value);
  try {
    return JSON.stringify(value, null, 2) ?? 'none';
  } catch {
    return 'none';
  }
}

// What a stored collection item holds besides what the user declared: its `id` and `text`, and a node memory's
// `entryKey`. Both the panel and the chip cards leave these out of an item's fields.
const ITEM_BOOKKEEPING: ReadonlySet<string> = new Set(['id', 'text', 'entryKey']);

/** The text of a stored item: its `text` field, or whatever that holds in words. */
export const itemText = (item: Record<string, unknown>): string =>
  typeof item.text === 'string' ? item.text : formatValue(item.text);

/** The fields an item declares (everything but its bookkeeping) as name and value in words. */
export const itemFields = (item: Record<string, unknown>): { name: string; value: string }[] =>
  Object.entries(item)
    .filter(([name]) => !ITEM_BOOKKEEPING.has(name))
    .map(([name, value]) => ({ name, value: formatValue(value) }));
