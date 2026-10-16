import { useEffect, useMemo, useState } from 'react';
import { presetSchema, settingsCatalog, stateHints, type Preset } from '@st/shared';
import { presetsApi } from '../api.js';
import {
  presetEditorStore,
  presetsStore,
  stateDefinitionsStore,
  useEditorCommands,
  useList,
  workflowsStore,
} from '../stores/index.js';
import { alerts } from '../alerts/index.js';
import { PresetEditor } from './presets/PresetEditor.js';
import { PresetEntryEditor } from './presets/PresetEntryEditor.js';
import { PresetPreview } from './presets/PresetPreview.js';
import { isImportedPreset } from './presets/presetImport.js';
import { duplicatePreset } from './presets/presetActions.js';
import { usePresetLiveSync } from './presets/usePresetLiveSync.js';
import './presets/presets.css';

export function Presets() {
  const [draft, setDraft] = useState<Preset>();
  const [saved, setSaved] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const readOnly = draft !== undefined && isImportedPreset(draft);
  const refresh = () => presetsStore.refresh();
  // A preset isn't tied to one workflow, so its hints offer every key any workflow declares.
  const workflows = useList(workflowsStore);
  const settings = useMemo(() => settingsCatalog(workflows), [workflows]);
  // Story state keys come from the definitions, never from a hand-written list.
  const definitions = useList(stateDefinitionsStore);
  const state = useMemo(() => stateHints(definitions), [definitions]);

  const openPreset = (preset: Preset, entryId: string) => {
    setDraft(structuredClone(preset));
    setSaved(JSON.stringify(preset));
    setSelectedEntryId(entryId);
  };
  const choose = (preset: Preset) => openPreset(preset, preset.entries[0]?.id ?? '');
  const closeEditor = () => {
    setDraft(undefined);
    setSaved('');
    setSelectedEntryId('');
  };
  const openId = draft?.id;
  useEffect(() => presetEditorStore.report(openId, dirty), [openId, dirty]);
  useEditorCommands(presetEditorStore, {
    open: choose,
    close: (id) => {
      if (draft?.id === id) closeEditor();
    },
  });
  usePresetLiveSync({
    editor: { draft, saved, selectedEntryId },
    refresh: () => presetsStore.refresh(),
    onReload: openPreset,
    onClose: closeEditor,
  });
  // Imported presets never change in the editor, so no edit can make them dirty.
  const change = (next: Preset) => {
    if (!readOnly) setDraft(next);
  };
  const save = async () => {
    if (!draft || readOnly) return;
    const parsed = presetSchema.safeParse(draft);
    if (!parsed.success) {
      alerts.error('Fix the preset validation errors before saving', {
        title: 'Invalid preset',
        details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      });
      return;
    }
    try {
      const result = await presetsApi.update(draft.id, draft);
      choose(result);
      await refresh();
      alerts.success('Preset saved');
    } catch {
      /* API errors are toasted. */
    }
  };
  const selectedEntry = draft?.entries.find((entry) => entry.id === selectedEntryId);

  return (
    <div className="presets-layout">
      {draft ? (
        <>
          <PresetEditor
            preset={draft}
            dirty={dirty}
            readOnly={readOnly}
            onChange={change}
            onSave={() => void save()}
            onDuplicate={() => void duplicatePreset(draft)}
            selectedEntryId={selectedEntryId}
            onSelectEntry={setSelectedEntryId}
          />
          <div className="preset-detail-column">
            <PresetEntryEditor
              preset={draft}
              entry={selectedEntry}
              readOnly={readOnly}
              settings={settings}
              state={state}
              onChange={(next) =>
                change({ ...draft, entries: draft.entries.map((item) => (item.id === next.id ? next : item)) })
              }
            />
          </div>
          <div className="preset-preview-column">
            <PresetPreview preset={draft} />
          </div>
        </>
      ) : (
        <div className="empty-state">
          <h1>Presets</h1>
          <p>Select or create a preset in the list.</p>
        </div>
      )}
    </div>
  );
}
