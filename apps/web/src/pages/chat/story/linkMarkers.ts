import { plainPreview, type LinkStatus, type SessionStateView } from '@st/shared';
import { linkLabel } from './linkedItems.js';
import { shortText } from './format.js';
import { definitionBlocks } from './storyModel.js';

// Which chat messages state items link to, for the marker on a message and for the note shown before editing or
// deleting one. Worked out once per loaded state view from the links the server computed (no fetch, no work per
// streamed token); the messages only look their id up.

/** One item that links to a message. */
export type MessageLinkNote = {
  /** `memory.summaries`. */
  key: string;
  /** "messages 1–20 (20)", the item's range. */
  range: string;
  /** The start of the item's text, to tell items of one key apart. */
  preview: string;
  status: LinkStatus;
};

export type MessageLinks = ReadonlyMap<string, readonly MessageLinkNote[]>;

const PREVIEW_MAX = 50;

/**
 * Message id -> the items that link to it: every linked item of every state definition key that still counts, i.e.
 * not replaced by intact items and not a repeat of an earlier one (those are collapsed in the panel too). A broken
 * item is listed with its status, because it is the reason the message may show raw text. Node keys never link.
 */
export function messageLinks(view: SessionStateView | undefined): MessageLinks {
  const found = new Map<string, MessageLinkNote[]>();
  if (!view) return found;
  for (const block of definitionBlocks(view)) {
    for (const row of block.keys) {
      if (!row.linked) continue;
      const { used, broken } = row.linked;
      for (const item of [...used, ...broken]) {
        const note: MessageLinkNote = {
          key: `${block.name}.${row.key}`,
          range: linkLabel(item.link),
          preview: shortText(plainPreview(item.text), PREVIEW_MAX),
          status: item.link.status,
        };
        for (const id of item.link.messageIds) found.set(id, [...(found.get(id) ?? []), note]);
      }
    }
  }
  return found;
}

/** The notes that are in use now (intact): what changing the message would stop. */
const inUse = (notes: readonly MessageLinkNote[]): MessageLinkNote[] =>
  notes.filter((note) => note.status === 'intact');

const keys = (notes: readonly MessageLinkNote[]) => [...new Set(notes.map((note) => note.key))].join(', ');

/**
 * The note shown before a message is edited or deleted: what stops being used. `undefined` when nothing in use
 * links to it (a broken item is already not used).
 */
export function changeNote(
  notes: readonly MessageLinkNote[] | undefined,
  action: 'edit' | 'delete',
): string | undefined {
  const active = inUse(notes ?? []);
  if (!active.length) return undefined;
  const count = active.length === 1 ? '1 item' : `${active.length} items`;
  const what = action === 'edit' ? 'Changing this message' : 'Deleting this message';
  return `${count} of ${keys(active)} link${active.length === 1 ? 's' : ''} to this message. ${what} stops ${active.length === 1 ? 'it' : 'them'} being used until ${active.length === 1 ? 'it is' : 'they are'} made again.`;
}
