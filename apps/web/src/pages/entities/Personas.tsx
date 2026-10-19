import { useEntityEditor } from './useEntityEditor.js';
import { EntityDropZone } from './EntityDropZone.js';
import { EntityDetail } from './EntityDetail.js';
import { EntityAvatar } from './EntityAvatar.js';
import { PersonaFields } from './PersonaFields.js';
import { personaKind } from './entityKinds.js';

/** The persona editor shown in R in place of the list. */
export function Personas() {
  const editor = useEntityEditor(personaKind);
  const { draft } = editor;
  return (
    <EntityDropZone dropLabel={personaKind.dropLabel} importFiles={editor.importFiles}>
      {draft ? (
        <EntityDetail
          title={draft.name}
          backLabel="Back to personas"
          dirty={editor.dirty}
          onBack={editor.back}
          onDelete={editor.remove}
          onSave={editor.save}
          onRevert={editor.revert}
        >
          <div className="persona-form">
            <EntityAvatar type="personas" item={draft} onUpload={editor.uploadAvatar} />
            <PersonaFields draft={draft} change={editor.change} />
          </div>
        </EntityDetail>
      ) : (
        <div className="empty-state">
          <h1>Personas</h1>
          <p>Select or create a persona, or drop an image to get started.</p>
        </div>
      )}
    </EntityDropZone>
  );
}
