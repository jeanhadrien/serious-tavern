import type { Preset, PresetEntry } from '@st/shared';
import type { DiskChange } from '../fileLiveSync.js';

/**
 * Compares the open preset with the fresh list from the server. `saved` is the serialization the editor
 * took the draft from, which is also what its dirty check compares against, so a UI save followed by its
 * own change event (same content) is `unchanged`.
 */
export function classifyDiskChange(
  editor: { draft?: Preset; saved: string },
  fresh: readonly Preset[],
): DiskChange<Preset> {
  const { draft } = editor;
  if (!draft) return { kind: 'unchanged' };
  const dirty = JSON.stringify(draft) !== editor.saved;
  const onDisk = fresh.find((preset) => preset.id === draft.id);
  if (!onDisk) return dirty ? { kind: 'conflict', removed: true, version: 'removed' } : { kind: 'removed' };
  const incoming = JSON.stringify(onDisk);
  if (incoming === editor.saved) return { kind: 'unchanged' };
  return dirty ? { kind: 'conflict', removed: false, version: incoming } : { kind: 'reload', item: onDisk };
}

/**
 * The entry to select after a reload. Entry ids are re-derived from the file on every read, so the
 * selection follows its position instead.
 */
export function reselectEntryId(
  oldEntries: readonly PresetEntry[],
  selectedId: string,
  newEntries: readonly PresetEntry[],
): string {
  const position = oldEntries.findIndex((entry) => entry.id === selectedId);
  if (position === -1) return newEntries[0]?.id ?? '';
  return newEntries[position]?.id ?? newEntries[newEntries.length - 1]?.id ?? '';
}
