import type { ApiBody, Preset, PresetSource } from '@st/shared';
import { importConnectors } from '../settings/importConnectors.js';
import { newId } from './PresetEntryList.js';

// Imported presets carry a server-owned `source` and can only be changed by duplicating them.
export const isImportedPreset = (preset: Pick<Preset, 'source'>) => preset.source !== undefined;

export function importedNotice(source: PresetSource): string {
  const app = importConnectors.find((connector) => connector.app === source.app)?.label ?? source.app;
  const origin = `Imported from ${app} (user ${source.user}, file ${source.file}).`;
  const missing = source.missing ? ' The source file no longer exists in the install, so this local copy is kept.' : '';
  return `${origin}${missing} It is read-only; duplicate it to get an editable copy.`;
}

// Builds the create body for a duplicate. `source` is never sent, so the copy is always editable.
// Entry ids are regenerated and depth placements are re-pointed at the copied slot.
export function copyPresetBody(preset: Preset): ApiBody<'createPreset'> {
  const entryIds = new Map(preset.entries.map((entry) => [entry.id, newId()]));
  return {
    name: `${preset.name} copy`,
    description: preset.description,
    inputs: preset.inputs.map((input) => ({ ...input, id: newId() })),
    entries: preset.entries.map((entry) =>
      entry.kind === 'message' && entry.placement.mode === 'depth'
        ? {
            ...entry,
            id: entryIds.get(entry.id)!,
            placement: {
              ...entry.placement,
              entryId: entryIds.get(entry.placement.entryId) ?? entry.placement.entryId,
            },
          }
        : { ...entry, id: entryIds.get(entry.id)! },
    ),
  };
}
