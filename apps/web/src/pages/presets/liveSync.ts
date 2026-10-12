import type { InvalidPresetFile, Preset, PresetEntry } from '@st/shared';

/** What an on-disk change means for the preset open in the editor. */
export type DiskChange =
  | { kind: 'unchanged' }
  /** The editor is clean and the file differs: show the new content. */
  | { kind: 'reload'; preset: Preset }
  /** The editor is clean and the preset no longer exists. */
  | { kind: 'removed' }
  /** The editor holds unsaved edits and the file moved on; `version` identifies the disk state, for warning once. */
  | { kind: 'conflict'; removed: boolean; version: string };

/**
 * Compares the open preset with the fresh list from the server. `saved` is the serialization the editor
 * took the draft from, which is also what its dirty check compares against, so a UI save followed by its
 * own change event (same content) is `unchanged`.
 */
export function classifyDiskChange(editor: { draft?: Preset; saved: string }, fresh: readonly Preset[]): DiskChange {
  const { draft } = editor;
  if (!draft) return { kind: 'unchanged' };
  const dirty = JSON.stringify(draft) !== editor.saved;
  const onDisk = fresh.find((preset) => preset.id === draft.id);
  if (!onDisk) return dirty ? { kind: 'conflict', removed: true, version: 'removed' } : { kind: 'removed' };
  const incoming = JSON.stringify(onDisk);
  if (incoming === editor.saved) return { kind: 'unchanged' };
  return dirty ? { kind: 'conflict', removed: false, version: incoming } : { kind: 'reload', preset: onDisk };
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

/**
 * Which invalid-file warnings to show or clear, given the (file -> reason) pairs already shown.
 * The same (file, reason) is never shown twice; a file whose reason changed is cleared and shown again.
 */
export function planInvalidFileAlerts(
  shown: ReadonlyMap<string, string>,
  invalid: readonly InvalidPresetFile[],
): { show: InvalidPresetFile[]; clear: string[] } {
  const current = new Map(invalid.map((item) => [item.file, item.reason]));
  const clear = [...shown].filter(([file, reason]) => current.get(file) !== reason).map(([file]) => file);
  const show = invalid.filter((item) => shown.get(item.file) !== item.reason);
  return { show, clear };
}

/** True when both lists serialize the same, so replacing one by the other would only cause a re-render. */
export const sameList = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);
