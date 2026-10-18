import { isPlainObject, itemLinkViewSchema, type ItemLinkView, type LinkStatus } from '@st/shared';

// The view model of linked collection items (items that link to chat messages): everything the Story state section
// and the message markers say about a link, worked out from the `link` the server's state view computed. Nothing
// here looks at the chat's messages or recomputes a status; the only rules of its own are how items are grouped
// and ordered for display, which follow the shared chat-order rule (`linkedInChatOrder`: by first linked message,
// an item linking the same messages as an earlier one is a duplicate).

/** The `link` of a raw view item, or undefined when it has none or it does not parse (then it is a plain item). */
export function itemLinkOf(raw: unknown): ItemLinkView | undefined {
  if (!isPlainObject(raw)) return undefined;
  const parsed = itemLinkViewSchema.safeParse(raw.link);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The text as a one-line preview: markdown markers (headings, emphasis, list dashes, code ticks) are dropped and
 * whitespace collapsed, so a summary starting "## Scene so far" reads as words in the collapsed line (the open
 * text is rendered as markdown).
 */
export function plainPreview(text: string): string {
  return text
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
 * Splits the linked items of one key for display. `items` come newest first (the collection's order), which the
 * stable sorts keep as the tie-break, like the shared rule does.
 */
export function groupLinked<T extends LinkedEntry>(items: readonly T[]): LinkGroups<T> {
  const intact = items.filter((item) => item.link.status === 'intact').sort(positionOrder);
  const seen = new Set<string>();
  const used: T[] = [];
  const hidden: T[] = [];
  for (const item of intact) {
    const same = item.link.messageIds.join('\u0000');
    if (seen.has(same)) hidden.push(item);
    else {
      seen.add(same);
      used.push(item);
    }
  }
  const broken: T[] = [];
  for (const item of items.filter((candidate) => candidate.link.status !== 'intact').sort(positionOrder))
    (item.link.replaced ? hidden : broken).push(item);
  return { used, broken, hidden };
}
