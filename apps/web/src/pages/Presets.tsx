import { useMemo, useState, type CSSProperties } from 'react';
import { presetSchema, settingsCatalog, stateHints, type Preset } from '@st/shared';
import { presetsApi } from '../api.js';
import {
  presetEditorStore,
  presetsStore,
  stateDefinitionsStore,
  useEditorCommands,
  useEditorSaver,
  useList,
  workflowsStore,
} from '../stores/index.js';
import { alerts } from '../alerts/index.js';
import { Splitter } from '../components/splitter/Splitter.js';
import { useStoredSize } from '../components/splitter/useStoredSize.js';
import { useEscapeArea } from '../keyboard/escapeRegistry.js';
import { useDraft } from './useDraft.js';
import { PresetEditor } from './presets/PresetEditor.js';
import { PresetEntryEditor } from './presets/PresetEntryEditor.js';
import { PresetPreview } from './presets/PresetPreview.js';
import { isImportedPreset } from './presets/presetImport.js';
import { duplicatePreset } from './presets/presetActions.js';
import { usePresetLiveSync } from './presets/usePresetLiveSync.js';
import './presets/presets.css';

// The entry list's width in the two-column layout (the wide and the stacked layouts have no splitter).
const LIST_WIDTH = { initial: 320, min: 220, max: 640 };

export function Presets() {
  const { draft, saved, savedKey, dirty, set, load, clear, revert } = useDraft(presetEditorStore);
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const listWidth = useStoredSize('preset-list', LIST_WIDTH);
  const readOnly = draft !== undefined && isImportedPreset(draft);
  const refresh = () => presetsStore.refresh();
  // A preset isn't tied to one workflow, so its hints offer every key any workflow declares.
  const workflows = useList(workflowsStore);
  const settings = useMemo(() => settingsCatalog(workflows), [workflows]);
  // Story state keys come from the definitions, never from a hand-written list.
  const definitions = useList(stateDefinitionsStore);
  const state = useMemo(() => stateHints(definitions), [definitions]);

  const openPreset = (preset: Preset, entryId: string) => {
    load(preset);
    setSelectedEntryId(entryId);
  };
  const choose = (preset: Preset) => openPreset(preset, preset.entries[0]?.id ?? '');
  const closeEditor = () => {
    clear();
    setSelectedEntryId('');
  };
  useEditorCommands(presetEditorStore, {
    open: choose,
    close: (id) => {
      if (draft?.id === id) closeEditor();
    },
  });
  usePresetLiveSync({
    editor: { draft, saved: savedKey ?? '', selectedEntryId },
    refresh: () => presetsStore.refresh(),
    onReload: openPreset,
    onClose: closeEditor,
  });
  // Imported presets never change in the editor, so no edit can make them dirty.
  const change = (next: Preset) => {
    if (!readOnly) set(next);
  };
  /** Resolves true when saved; false on a validation failure, an API error (toasted) or a read-only preset. */
  const save = async (): Promise<boolean> => {
    if (!draft || readOnly) return false;
    const parsed = presetSchema.safeParse(draft);
    if (!parsed.success) {
      alerts.error('Fix the preset validation errors before saving', {
        title: 'Invalid preset',
        details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      });
      return false;
    }
    try {
      const result = await presetsApi.update(draft.id, draft);
      choose(result);
      await refresh();
      alerts.success('Preset saved');
      return true;
    } catch {
      /* API errors are toasted. */
      return false;
    }
  };
  /** Back to the saved preset; the selected entry stays unless the revert removes it. */
  const revertDraft = () => {
    revert();
    if (saved && !saved.entries.some((entry) => entry.id === selectedEntryId))
      setSelectedEntryId(saved.entries[0]?.id ?? '');
  };
  useEditorSaver(presetEditorStore, { label: () => draft?.name ?? '', save });
  // Escape first drops the entry selection; the shell's default then closes the editor.
  useEscapeArea('editor:presets', () => {
    if (!selectedEntryId) return false;
    setSelectedEntryId('');
    return true;
  });
  const selectedEntry = draft?.entries.find((entry) => entry.id === selectedEntryId);

  return (
    <div className="presets-layout" style={{ '--preset-list-width': `${listWidth.size}px` } as CSSProperties}>
      {draft ? (
        <>
          <PresetEditor
            preset={draft}
            dirty={dirty}
            readOnly={readOnly}
            onChange={change}
            onSave={() => void save()}
            onRevert={revertDraft}
            onDuplicate={() => void duplicatePreset(draft)}
            selectedEntryId={selectedEntryId}
            onSelectEntry={setSelectedEntryId}
          />
          <Splitter
            className="preset-list-splitter"
            label="Resize entry list"
            value={listWidth.size}
            min={LIST_WIDTH.min}
            max={LIST_WIDTH.max}
            onChange={listWidth.setSize}
            onReset={listWidth.reset}
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
