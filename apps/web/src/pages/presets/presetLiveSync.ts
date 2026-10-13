import type { Preset } from '@st/shared';
import { startFileLiveSync, type LiveSyncDeps } from '../fileLiveSync.js';
import { classifyDiskChange, reselectEntryId } from './liveSync.js';

export interface LiveSyncOptions {
  /** The open preset, the serialization it was loaded from (the dirty check's baseline) and the selected entry. */
  editor: { draft?: Preset; saved: string; selectedEntryId: string };
  /** Fetches the catalog (updating the list view) and returns it. */
  refresh(): Promise<Preset[]>;
  onReload(preset: Preset, selectedEntryId: string): void;
  onClose(): void;
}

const PRESETS = {
  event: 'presets.changed',
  noun: 'preset',
  removedHint: 'Saving will fail; duplicate the preset to keep your edits.',
} as const;

/**
 * Keeps the presets page in step with edits made to the preset files on disk (see `startFileLiveSync`). A reload
 * keeps the selected entry by position, since entry ids are re-derived on every read. Returns the stop function.
 */
export function startPresetLiveSync(current: () => LiveSyncOptions, deps?: LiveSyncDeps): () => void {
  return startFileLiveSync<Preset>(
    PRESETS,
    () => {
      const { editor, refresh, onReload, onClose } = current();
      return {
        signature: () => `${editor.draft?.id ?? ''}\n${editor.saved}`,
        refresh,
        classify: (fresh) => classifyDiskChange(editor, fresh),
        openName: () => editor.draft?.name ?? '',
        onReload: (preset) =>
          onReload(preset, reselectEntryId(editor.draft?.entries ?? [], editor.selectedEntryId, preset.entries)),
        onClose,
      };
    },
    deps,
  );
}
