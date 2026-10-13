import { characterSchema, type Character } from '@st/shared';
import { charactersApi } from '../../api.js';
import { charactersStore } from '../../stores/index.js';
import { alerts } from '../../alerts/index.js';
import { useEntityEditor } from './useEntityEditor.js';
import { EntityPage } from './EntityPage.js';
import { EntityList } from './EntityList.js';
import { EntityDetail } from './EntityDetail.js';
import { EntityAvatar } from './EntityAvatar.js';
import { CharacterFields } from './CharacterFields.js';

export function Characters() {
  const editor = useEntityEditor<Character>({
    label: 'Character',
    store: charactersStore,
    create: () => charactersApi.create({ name: 'New character' }),
    save: (draft) => charactersApi.update(draft.id, draft),
    delete: charactersApi.delete,
    import: charactersApi.import,
    uploadAvatar: charactersApi.uploadAvatar,
    validate: (draft) => {
      const parsed = characterSchema.safeParse(draft);
      if (!parsed.success)
        alerts.error('Fix the character validation errors before saving', {
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
        });
      return parsed.success;
    },
    prepareFiles: (files) => files,
    imported: (count) => alerts.success(`Imported ${count} character${count === 1 ? '' : 's'}`),
    failed: (failures) =>
      alerts.error(`${failures.length} character file${failures.length === 1 ? '' : 's'} could not be imported`, {
        details: failures.map((item) => `${item.filename}: ${item.error.message}`).join('\n'),
      }),
  });
  const { draft } = editor;
  return (
    <EntityPage dropLabel="Drop character card PNG or JSON files to import" importFiles={editor.importFiles}>
      <EntityList
        type="characters"
        title="Characters"
        importLabel="Import cards"
        accept=".json,.png,application/json,image/png"
        list={editor.list}
        selectedId={draft?.id}
        dirty={editor.dirty}
        onSelect={editor.choose}
        onCreate={editor.create}
        onImport={editor.importFiles}
      />
      {draft ? (
        <EntityDetail
          title={draft.name || 'Character'}
          dirty={editor.dirty}
          onDelete={editor.remove}
          onSave={editor.save}
          actions={
            <>
              <button onClick={() => window.open(charactersApi.exportUrl(draft.id, 'json'), '_blank')}>
                Export JSON
              </button>
              <button onClick={() => window.open(charactersApi.exportUrl(draft.id, 'png'), '_blank')}>
                Export PNG card
              </button>
            </>
          }
        >
          <div className="character-form">
            <EntityAvatar type="characters" item={draft} onUpload={editor.uploadAvatar} />
            <CharacterFields draft={draft} change={editor.change} />
          </div>
        </EntityDetail>
      ) : (
        <div className="empty-state">
          <h1>Characters</h1>
          <p>Select a character or import a character card.</p>
        </div>
      )}
    </EntityPage>
  );
}
