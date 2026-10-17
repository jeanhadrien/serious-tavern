import { WRITE_PREVIEW_LIMIT } from '../api/state.js';
import type { StateWrite } from './writes.js';

/**
 * A stored write as the state view shows it. Long text is cut to `WRITE_PREVIEW_LIMIT` characters and a large
 * object becomes its JSON text, cut the same way, so the view of a long chat stays small whatever its keys hold.
 * Item ids are never cut. The stored write is not changed.
 */
export function previewWrite(write: StateWrite): { write: StateWrite; truncated: boolean } {
  let truncated = false;
  const shorten = (value: unknown): unknown => {
    const text = typeof value === 'string' ? value : typeof value === 'object' && value ? JSON.stringify(value) : '';
    if (text.length <= WRITE_PREVIEW_LIMIT) return value;
    truncated = true;
    return text.slice(0, WRITE_PREVIEW_LIMIT);
  };
  if (write.op === 'set') {
    const value = shorten(write.value);
    return { write: truncated ? { ...write, value } : write, truncated };
  }
  if (write.op === 'add') {
    const item = Object.fromEntries(
      Object.entries(write.item).map(([name, value]) => [name, name === 'id' ? value : shorten(value)]),
    ) as typeof write.item;
    return { write: truncated ? { ...write, item } : write, truncated };
  }
  return { write, truncated };
}
