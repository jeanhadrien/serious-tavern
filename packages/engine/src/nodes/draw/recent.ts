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
