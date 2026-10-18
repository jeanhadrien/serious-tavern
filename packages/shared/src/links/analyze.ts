import { indexById, type LinkMessage } from './fingerprint.js';
import { linkStatus, type LinkStatus } from './status.js';
import type { ItemLink } from '../state/writes.js';

/** An item that may carry a link (a collection item). */
export type LinkableItem = { id: string; messages?: ItemLink | undefined };

/** What the chat says about one linked item. Positions are 1-based among the history messages. */
export type LinkedEntry<T extends LinkableItem = LinkableItem> = {
  item: T;
  link: ItemLink;
  status: LinkStatus;
  /** The linked ids that are still among the history messages, in the link's order. */
  survivors: string[];
  /** The first and last surviving linked message by position in the chat; absent when none survives. */
  first?: number;
  last?: number;
  firstId?: string;
  lastId?: string;
  /**
   * A broken item (not intact) whose surviving messages are ALL linked by intact items of the same key: whatever it
   * was for is covered again, so readers skip it. A `gone` item has nothing left to cover and is never replaced.
   */
  replaced: boolean;
};

/**
 * Links of the items of ONE key against the history messages (`historyMessages`, in chat order), in the items' order.
 * Items without a link are left out. One function behind the planner, Unlinked Messages and the state view.
 */
export function analyzeLinks<T extends LinkableItem>(
  items: readonly T[],
  history: readonly LinkMessage[],
): LinkedEntry<T>[] {
  const byId = indexById(history);
  const position = new Map(history.map((message, index) => [message.id, index + 1]));
  const entries = items.flatMap((item): LinkedEntry<T>[] => {
    const link = item.messages;
    if (!link) return [];
    const survivors = link.ids.filter((id) => position.has(id));
    let first: string | undefined;
    let last: string | undefined;
    for (const id of survivors) {
      if (first === undefined || position.get(id)! < position.get(first)!) first = id;
      if (last === undefined || position.get(id)! > position.get(last)!) last = id;
    }
    return [
      {
        item,
        link,
        status: linkStatus(link, byId),
        survivors,
        ...(first === undefined || last === undefined
          ? {}
          : { first: position.get(first)!, last: position.get(last)!, firstId: first, lastId: last }),
        replaced: false,
      },
    ];
  });
  const covered = new Set(entries.filter(({ status }) => status === 'intact').flatMap(({ link }) => link.ids));
  for (const entry of entries)
    entry.replaced =
      entry.status !== 'intact' && entry.survivors.length > 0 && entry.survivors.every((id) => covered.has(id));
  return entries;
}

/** The link as templates and nodes see it on a turn-start snapshot item. */
export type RunItemLink = {
  status: LinkStatus;
  /** The stored ids. */
  ids: string[];
  /** The position (1-based, among the run's history messages) of the first surviving linked message; absent when gone. */
  first?: number;
};

/**
 * The items with a read-only computed `link` on those that have `messages` (the others are returned as they are). The
 * items themselves are not changed. This is what a run's snapshot holds; a stored item never has a `link`.
 */
export function withItemLinks<T extends LinkableItem>(
  items: readonly T[],
  history: readonly LinkMessage[],
): (T & { link?: RunItemLink })[] {
  const byItem = new Map(analyzeLinks(items, history).map((entry) => [entry.item, entry]));
  return items.map((item) => {
    const entry = byItem.get(item);
    if (!entry) return item;
    return {
      ...item,
      link: {
        status: entry.status,
        ids: [...entry.link.ids],
        ...(entry.first === undefined ? {} : { first: entry.first }),
      },
    };
  });
}
