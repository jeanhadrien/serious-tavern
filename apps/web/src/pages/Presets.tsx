import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { presetSchema, type Preset } from '@st/shared';
import { presetsApi } from '../api.js';
import { alerts } from '../alerts/index.js';
import { PresetList } from './presets/PresetList.js';
import { PresetEditor } from './presets/PresetEditor.js';
import { PresetEntryEditor } from './presets/PresetEntryEditor.js';
import { PresetPreview } from './presets/PresetPreview.js';

const id = () => crypto.randomUUID();

export function Presets() {
  const [params] = useSearchParams();
  const [list, setList] = useState<Preset[]>([]);
  const [draft, setDraft] = useState<Preset>();
  const [saved, setSaved] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  const refresh = async () => setList(await presetsApi.list());

  useEffect(() => {
    void refresh().catch(() => {});
  }, []);
  useEffect(() => {
    const preset = list.find((item) => item.id === params.get('id'));
    if (preset && !draft) choose(preset);
  }, [list, params, draft]);

  const choose = (preset: Preset) => {
    setDraft(structuredClone(preset));
    setSaved(JSON.stringify(preset));
    setSelectedEntryId(preset.entries[0]?.id ?? '');
  };
  const change = (next: Preset) => setDraft(next);
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
    if (!draft) return;
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
      const entryIds = new Map(preset.entries.map((item) => [item.id, id()]));
      const copy = await presetsApi.create({
        ...preset,
        name: `${preset.name} copy`,
        inputs: preset.inputs.map((input) => ({ ...input, id: id() })),
        entries: preset.entries.map((item) =>
          item.kind === 'message' && item.placement.mode === 'depth'
            ? {
                ...item,
                id: entryIds.get(item.id)!,
                placement: {
                  ...item.placement,
                  entryId: entryIds.get(item.placement.entryId) ?? item.placement.entryId,
                },
              }
            : { ...item, id: entryIds.get(item.id)! },
        ),
      });
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
      if (draft?.id === preset.id) {
        setDraft(undefined);
        setSaved('');
        setSelectedEntryId('');
      }
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
            onChange={change}
            onSave={() => void save()}
            selectedEntryId={selectedEntryId}
            onSelectEntry={setSelectedEntryId}
          />
          <div className="preset-detail-column">
            <PresetEntryEditor
              preset={draft}
              entry={selectedEntry}
              onChange={(next) =>
                change({ ...draft, entries: draft.entries.map((item) => (item.id === next.id ? next : item)) })
              }
            />
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
