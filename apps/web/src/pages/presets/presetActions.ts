import type { Preset } from '@st/shared';
import { presetsApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import { presetEditorStore, presetsStore } from '../../stores/index.js';
import { copyPresetBody } from './presetImport.js';
import { confirmDelete } from '../../components/dialog/dialogStore.js';

// Preset operations shared by the list (in L) and the editor (in M). Each opens the result in the editor and
// resolves with whether it succeeded; API errors are toasted by the transport. Creating and duplicating first ask
// Save / Discard / Cancel when the open draft is dirty (Cancel resolves false and writes nothing).

export async function createPreset(): Promise<boolean> {
  if (!(await presetEditorStore.confirmSwitch())) return false;
  try {
    const created = await presetsApi.create({ name: 'New preset', inputs: [], entries: [] });
    await presetsStore.refresh();
    presetEditorStore.open(created);
    return true;
  } catch {
    return false;
  }
}

export async function duplicatePreset(preset: Preset): Promise<boolean> {
  if (!(await presetEditorStore.confirmSwitch())) return false;
  try {
    const copy = await presetsApi.create(copyPresetBody(preset));
    await presetsStore.refresh();
    presetEditorStore.open(copy);
    alerts.success('Preset duplicated');
    return true;
  } catch {
    return false;
  }
}

export async function deletePreset(preset: Preset): Promise<void> {
  if (!(await confirmDelete(`Delete preset "${preset.name}"?`))) return;
  try {
    await presetsApi.delete(preset.id);
    presetEditorStore.discard(preset.id);
    await presetsStore.refresh();
  } catch {
    /* In-use errors are toasted automatically. */
  }
}
