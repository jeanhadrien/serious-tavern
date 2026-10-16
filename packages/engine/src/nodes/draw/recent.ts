import { createHash } from 'node:crypto';
import type { StateKeyView } from '@st/shared';
import type { Candidate } from '../../collections.js';

/**
 * What Draw remembers about an entry: its collection and a fingerprint of its text. Entry ids are positions
 * (`entry-3`) and shift when someone reorders or deletes entries, but the text identifies the entry; editing
 * the text makes it a new entry, which is eligible again.
 */
export function entryKey({ collectionId, entry }: Candidate): string {
  const fingerprint = createHash('sha1').update(entry.text.trim()).digest('hex').slice(0, 16);
  return `${collectionId}:${fingerprint}`;
}

/** How many characters of a drawn entry Draw keeps in its memory: a reminder for people, never read back. */
const MEMORY_TEXT_LENGTH = 80;

/**
 * The text Draw stores with a remembered draw: the entry's first 80 characters (whole characters, never half
 * of an emoji). Only `entryKey` is read when excluding, so the full text would only make the chat's state grow
 * by an entry per draw.
 */
export function memoryText(text: string): string {
  return [...text.trim().slice(0, MEMORY_TEXT_LENGTH * 2)].slice(0, MEMORY_TEXT_LENGTH).join('');
}

/**
 * The entry keys drawn within the last `avoidRecent` turns, from Draw's own `draws` key (items newest first,
 * with the turn that added each). An item added in present turn `t` while turn `turn` runs is recent when
 * `turn - t <= avoidRecent`, so 1 means "not the entry drawn last turn". Items without a turn count as old.
 */
export function recentEntryKeys(view: StateKeyView | undefined, turn: number, avoidRecent: number): Set<string> {
  const keys = new Set<string>();
  if (!view || !Array.isArray(view.value)) return keys;
  view.value.forEach((item, index) => {
    const drawnAt = view.itemTurns?.[index];
    const key = (item as { entryKey?: unknown } | null)?.entryKey;
    if (drawnAt !== undefined && typeof key === 'string' && turn - drawnAt <= avoidRecent) keys.add(key);
  });
  return keys;
}
