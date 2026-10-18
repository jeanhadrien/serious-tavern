import { analyzeLinks, type ChatMessage, type ItemLinkView, type LinkableItem } from '@st/shared';

/**
 * The items of a collection key as the state view shows them: those that link to messages get `link` (see
 * `itemLinkViewSchema`), judged against the chat's history messages as they are now. Items without a link, and the
 * items themselves, are not changed.
 */
export function withLinkViews<T extends LinkableItem>(
  items: readonly T[],
  history: readonly ChatMessage[],
): (T & { link?: ItemLinkView })[] {
  const byItem = new Map(analyzeLinks(items, history).map((entry) => [entry.item, entry]));
  return items.map((item) => {
    const entry = byItem.get(item);
    if (!entry) return item;
    return {
      ...item,
      link: {
        status: entry.status,
        replaced: entry.replaced,
        repeated: entry.repeated,
        count: entry.link.ids.length,
        missing: entry.link.ids.length - entry.survivors.length,
        ...(entry.first === undefined
          ? {}
          : {
              firstIndex: entry.first,
              lastIndex: entry.last,
              firstMessageId: entry.firstId,
              lastMessageId: entry.lastId,
            }),
        messageIds: [...entry.survivors],
      },
    };
  });
}
