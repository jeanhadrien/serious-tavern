import { charactersApi } from '../../api.js';
import { useEntityEditor } from './useEntityEditor.js';
import { EntityDropZone } from './EntityDropZone.js';
import { EntityDetail } from './EntityDetail.js';
import { EntityAvatar } from './EntityAvatar.js';
import { CharacterFields } from './CharacterFields.js';
import { characterKind } from './entityKinds.js';

/** The character editor shown in R in place of the list. */
export function Characters() {
  const editor = useEntityEditor(characterKind);
  const { draft } = editor;
  return (
    <EntityDropZone dropLabel={characterKind.dropLabel} importFiles={editor.importFiles}>
      {draft ? (
        <EntityDetail
          title={draft.name || 'Character'}
          backLabel="Back to characters"
          dirty={editor.dirty}
          onBack={editor.back}
          onDelete={editor.remove}
          onSave={editor.save}
          onRevert={editor.revert}
          actions={
            <>
              <button type="button" onClick={() => window.open(charactersApi.exportUrl(draft.id, 'json'), '_blank')}>
                Export JSON
              </button>
              <button type="button" onClick={() => window.open(charactersApi.exportUrl(draft.id, 'png'), '_blank')}>
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
    </EntityDropZone>
  );
}
