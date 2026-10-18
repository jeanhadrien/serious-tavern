import type { ItemLinkView } from './analyze.js';
import { isPlainObject } from '../state/helpers.js';

/**
 * The intact linked items of a collection value in chat order: by the position of their first linked message (items
 * with the same position keep the collection's order, newest first), and an item linking exactly the same messages as
 * an earlier one is dropped (a re-summary of a chunk whose edit was reverted). Anything but a list gives an empty list,
 * and so does an item whose `link` is missing, broken or not intact. Reads the `link` of a snapshot item, so templates
 * (`linked`) and State Read give the same result.
 */
export function linkedInChatOrder(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const linked = value.flatMap((item, index) => {
    const link = isPlainObject(item) && isPlainObject(item.link) ? (item.link as Partial<ItemLinkView>) : undefined;
    if (link?.status !== 'intact' || typeof link.first !== 'number' || !Array.isArray(link.ids)) return [];
    return [{ item, first: link.first, key: link.ids.join('\u0000'), index }];
  });
  linked.sort((a, b) => a.first - b.first || a.index - b.index);
  const seen = new Set<string>();
  return linked.filter(({ key }) => !seen.has(key) && seen.add(key)).map(({ item }) => item);
}
