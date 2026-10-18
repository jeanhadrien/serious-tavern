import { isPlainObject, itemLinkViewSchema, type ItemLinkView, type LinkStatus } from '@st/shared';

// The view model of linked collection items (items that link to chat messages): everything the Story state section
// and the message markers say about a link, worked out from the `link` the server's state view computed. Nothing
// here looks at the chat's messages or recomputes a status, a replacement or a repeat (the view carries them, from the
// shared rules); the only thing decided here is the display order, by first linked message.

/** The `link` of a raw view item, or undefined when it has none or it does not parse (then it is a plain item). */
export function itemLinkOf(raw: unknown): ItemLinkView | undefined {
  if (!isPlainObject(raw)) return undefined;
  const parsed = itemLinkViewSchema.safeParse(raw.link);
  return parsed.success ? parsed.data : undefined;
}

/** How each status reads on the badge. */
export const STATUS_LABELS: Record<LinkStatus, string> = {
  intact: 'intact',
  changed: 'covers an edited message',
  partial: 'some messages deleted',
  gone: 'all messages deleted',
};

/** Said for an item that readers skip. */
export const BROKEN_EXPLANATION =
  'Not used until its messages match again (an edit undone) or a Next Chunk node redoes it.';
export const REPLACED_EXPLANATION = 'Replaced: intact items link every message of it that is left, so readers skip it.';
export const GONE_EXPLANATION = 'Not used: none of its messages is in the chat any more.';

/** "messages 21–40 (20)"; "message 7"; with deletions "messages 21–38 (18 of 20 left)"; none left "all 20 messages deleted". */
export function linkLabel({ count, missing, firstIndex, lastIndex }: ItemLinkView): string {
  const left = Math.max(0, count - missing);
  if (firstIndex === undefined || lastIndex === undefined || left === 0)
    return count === 1 ? 'its message was deleted' : `all ${count} messages deleted`;
  const range = firstIndex === lastIndex ? `message ${firstIndex}` : `messages ${firstIndex}–${lastIndex}`;
  if (missing > 0) return `${range} (${left} of ${count} left)`;
  return left === 1 && firstIndex === lastIndex ? range : `${range} (${left})`;
}

/** What the groups need of an item. */
export type LinkedEntry = { id: string; link: ItemLinkView };

export type LinkGroups<T extends LinkedEntry> = {
  /** Intact items in chat order, the ones readers use. */
  used: T[];
  /** Not intact and not replaced: waiting to be redone. */
  broken: T[];
  /** Replaced by intact items, or an intact copy of an earlier item (an edit that was reverted). */
  hidden: T[];
};

const positionOrder = (a: LinkedEntry, b: LinkedEntry) =>
  (a.link.firstIndex ?? Number.POSITIVE_INFINITY) - (b.link.firstIndex ?? Number.POSITIVE_INFINITY);

/**
 * Splits the linked items of one key for display, by what the server's view says about each (`link.status`,
 * `replaced`, `repeated`: the rules live in shared, nothing is decided here). The lists are shown in chat order by
 * `firstIndex`; `items` come newest first, which the stable sort keeps for ties.
 */
export function groupLinked<T extends LinkedEntry>(items: readonly T[]): LinkGroups<T> {
  const groups: LinkGroups<T> = { used: [], broken: [], hidden: [] };
  for (const item of [...items].sort(positionOrder)) {
    const { link } = item;
    if (link.status === 'intact') (link.repeated ? groups.hidden : groups.used).push(item);
    else (link.replaced ? groups.hidden : groups.broken).push(item);
  }
  return groups;
}
