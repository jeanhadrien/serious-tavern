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
