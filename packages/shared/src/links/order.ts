import type { RunItemLink } from './analyze.js';
import { isPlainObject } from '../state/helpers.js';

/**
 * The one rule for reading linked items in chat order, over items that are INTACT: they sort by the position of their
 * first linked message (ties keep the given order, the collection's newest first), and an item that links exactly the
 * same messages (`key`) as an earlier one in that order is a repeat (a re-summary of a chunk whose edit was reverted).
 * Returns the indexes of the items to use, in chat order, and the indexes of the repeats. Pure.
 */
export function chatOrder(items: readonly { first: number; key: string }[]): { used: number[]; repeated: Set<number> } {
  const order = items.map((_, index) => index).sort((a, b) => items[a]!.first - items[b]!.first || a - b);
  const seen = new Set<string>();
  const used: number[] = [];
  const repeated = new Set<number>();
  for (const index of order) {
    const { key } = items[index]!;
    if (seen.has(key)) repeated.add(index);
    else {
      seen.add(key);
      used.push(index);
    }
  }
  return { used, repeated };
}

/**
 * The intact linked items of a collection value in chat order (see `chatOrder`). Anything but a list gives an empty
 * list, and so does an item whose `link` is missing, broken or not intact. Reads the `link` of a snapshot item, so
 * templates (`linked`) and State Read give the same result.
 */
export function linkedInChatOrder(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const linked = value.flatMap((item) => {
    const link = isPlainObject(item) && isPlainObject(item.link) ? (item.link as Partial<RunItemLink>) : undefined;
    if (link?.status !== 'intact' || typeof link.first !== 'number' || !Array.isArray(link.ids)) return [];
    return [{ item, first: link.first, key: link.ids.join('\u0000') }];
  });
  return chatOrder(linked).used.map((index) => linked[index]!.item);
}
