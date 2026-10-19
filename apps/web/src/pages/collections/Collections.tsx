import { CollectionEditor } from './CollectionEditor.js';
import { useCollectionEditor } from './useCollectionEditor.js';
import './collections.css';

/** The collection editor view, shown in R in place of the collections list. */
export function Collections() {
  const editor = useCollectionEditor();
  if (editor.loading)
    return (
      <div className="empty-state">
        <h1>Collections</h1>
        <p>Loading the collection…</p>
      </div>
    );
  if (!editor.draft)
    return (
      <div className="empty-state">
        <h1>Collections</h1>
        <p>Select a collection, or create one.</p>
      </div>
    );
  return (
    <CollectionEditor
      draft={editor.draft}
      dirty={editor.dirty}
      saving={editor.saving}
      errors={editor.errors}
      selected={editor.selected}
      entryIds={editor.entryIds}
      onChange={editor.change}
      onSelect={editor.select}
      onEntryChange={editor.updateEntry}
      onAddEntry={editor.addEntry}
      onRemoveEntry={editor.removeEntry}
      onMoveEntry={editor.moveEntry}
      onSave={() => void editor.save()}
      onRevert={() => void editor.revert()}
      onDelete={() => void editor.remove()}
      onBack={editor.back}
    />
  );
}
