import { StateDefinitionEditor } from './StateDefinitionEditor.js';
import { useStateDefinitionEditor } from './useStateDefinitionEditor.js';
import './stateDefinitions.css';

/** The state definition editor view, shown in L in place of the definitions list. */
export function StateDefinitions() {
  const editor = useStateDefinitionEditor();
  if (!editor.draft)
    return (
      <div className="empty-state">
        <h1>State definitions</h1>
        <p>Select a state definition, or create one.</p>
      </div>
    );
  return (
    <StateDefinitionEditor
      draft={editor.draft}
      dirty={editor.dirty}
      problems={editor.problems}
      nameLocked={editor.nameLocked}
      nameTaken={editor.nameTaken}
      blocked={editor.blocked}
      saving={editor.saving}
      onChange={editor.change}
      onSave={() => void editor.save()}
      onDelete={() => void editor.remove()}
      onDuplicate={() => void editor.duplicate()}
      onDuplicateAs={() => void editor.duplicateAs()}
      onKeepName={editor.keepName}
      onBack={editor.back}
    />
  );
}
