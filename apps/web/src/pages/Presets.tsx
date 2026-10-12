import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { presetSchema, type Preset } from '@st/shared';
import { presetsApi } from '../api.js';
import type { RequestOptions } from '../api/transport.js';
import { useRefreshOnTabActive } from '../useTabActivation.js';
import { alerts } from '../alerts/index.js';
import { compareRecent } from './recentOrder.js';
import { PresetList } from './presets/PresetList.js';
import { PresetEditor } from './presets/PresetEditor.js';
import { PresetEntryEditor } from './presets/PresetEntryEditor.js';
import { PresetPreview } from './presets/PresetPreview.js';
import { copyPresetBody, isImportedPreset } from './presets/presetImport.js';
import { sameList } from './presets/liveSync.js';
import { usePresetLiveSync } from './presets/usePresetLiveSync.js';
import './presets/presets.css';

export function Presets() {
  const [params] = useSearchParams();
  const requestedId = params.get('id');
  const requestedPresetRef = useRef<string | null>(null);
  const [list, setList] = useState<Preset[]>([]);
  const [draft, setDraft] = useState<Preset>();
  const [saved, setSaved] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const readOnly = draft !== undefined && isImportedPreset(draft);
  // Fetches the catalog, newest first. An unchanged list keeps its identity, so nothing re-renders.
  const refresh = async (options?: RequestOptions) => {
    const fresh = (await presetsApi.list(options)).sort((a, b) => compareRecent(a, b, (preset) => preset.name));
    setList((current) => (sameList(current, fresh) ? current : fresh));
    return fresh;
  };

  useEffect(() => {
    void refresh().catch(() => {});
  }, []);
  useEffect(() => {
    // Tabs stay mounted: a preset link must open even when another draft is showing.
    if (!requestedId || requestedPresetRef.current === requestedId) return;
    const preset = list.find((item) => item.id === requestedId);
    if (preset) {
      requestedPresetRef.current = requestedId;
      choose(preset);
    }
  }, [list, requestedId]);
  useRefreshOnTabActive('/presets', () => void refresh());

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
  usePresetLiveSync({
    editor: { draft, saved, selectedEntryId },
    refresh: () => refresh({ silent: true }),
    onReload: openPreset,
    onClose: closeEditor,
  });
  // Imported presets never change in the editor, so no edit can make them dirty.
  const change = (next: Preset) => {
    if (!readOnly) setDraft(next);
  };
  const create = async () => {
    try {
      const created = await presetsApi.create({ name: 'New preset', inputs: [], entries: [] });
      await refresh();
      choose(created);
    } catch {
      /* API errors are toasted. */
    }
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
  const duplicate = async (preset: Preset) => {
    try {
      const copy = await presetsApi.create(copyPresetBody(preset));
      await refresh();
      choose(copy);
      alerts.success('Preset duplicated');
    } catch {
      /* API errors are toasted. */
    }
  };
  const remove = async (preset: Preset) => {
    if (!window.confirm(`Delete ${preset.name}?`)) return;
    try {
      await presetsApi.delete(preset.id);
      if (draft?.id === preset.id) closeEditor();
      await refresh();
    } catch {
      /* In-use errors are toasted automatically. */
    }
  };
  const selectedEntry = draft?.entries.find((entry) => entry.id === selectedEntryId);

  return (
    <div className="presets-layout">
      <PresetList
        presets={list}
        selectedId={draft?.id}
        dirtyId={dirty ? draft?.id : undefined}
        onSelect={choose}
        onCreate={() => void create()}
        onDuplicate={(preset) => void duplicate(preset)}
        onDelete={(preset) => void remove(preset)}
      />
      {draft ? (
        <>
          <PresetEditor
            preset={draft}
            dirty={dirty}
            readOnly={readOnly}
            onChange={change}
            onSave={() => void save()}
            onDuplicate={() => void duplicate(draft)}
            selectedEntryId={selectedEntryId}
            onSelectEntry={setSelectedEntryId}
          />
          <div className="preset-detail-column">
            <PresetEntryEditor
              preset={draft}
              entry={selectedEntry}
              readOnly={readOnly}
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
          <p>Select or create a preset.</p>
        </div>
      )}
    </div>
  );
}
