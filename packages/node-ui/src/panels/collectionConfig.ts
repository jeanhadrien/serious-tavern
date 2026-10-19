// Pure helpers of the Recall and Draw panels.

/** A comma-separated list as typed: trimmed items, blanks dropped. */
export const parseList = (text: string): string[] =>
  text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const formatList = (items: unknown): string => (Array.isArray(items) ? items.map(String).join(', ') : '');

const ESCAPES: Record<string, string> = { '\n': '\\n', '\t': '\\t', '\\': '\\\\' };
const UNESCAPES: Record<string, string> = { n: '\n', t: '\t', '\\': '\\' };

/** Shows a separator on one line: new lines and tabs as `\n` and `\t`, a backslash doubled. */
export const escapeSeparator = (text: string) => text.replace(/[\n\t\\]/g, (char) => ESCAPES[char]!);

/** Reads an escaped separator back. Any other backslash sequence stays as typed. */
export const unescapeSeparator = (text: string) => text.replace(/\\([nt\\])/g, (_, char: string) => UNESCAPES[char]!);

/** A whole number of at least `min` typed as text, or undefined while it isn't one. */
export function parseCount(text: string, min: number): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= min ? value : undefined;
}

export type PickerRow = { id: string; name: string; known: boolean };

/**
 * The picked collections in config order, named from the catalog; ids without a record show as unknown. A repeated
 * id (hand-edited config) is shown once, first wins, as the nodes read it.
 */
export function pickerRows(ids: unknown, catalog: readonly { id: string; name: string }[]): PickerRow[] {
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  return list.map((id) => {
    const record = catalog.find((item) => item.id === id);
    return record ? { id, name: record.name, known: true } : { id, name: `Unknown collection (${id})`, known: false };
  });
}

export const addId = (ids: readonly string[], id: string) => (ids.includes(id) ? [...ids] : [...ids, id]);
export const removeId = (ids: readonly string[], id: string) => ids.filter((item) => item !== id);

/** Which way `Alt+ArrowUp` / `Alt+ArrowDown` moves a row (-1 up, 1 down); undefined for any other key. */
export function altArrowOffset(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): -1 | 1 | undefined {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
  if (event.key === 'ArrowUp') return -1;
  return event.key === 'ArrowDown' ? 1 : undefined;
}

/** Moves an id one place up (-1) or down (+1); out-of-range moves change nothing. */
export function moveId(ids: readonly string[], index: number, offset: -1 | 1): string[] {
  const to = index + offset;
  if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}
