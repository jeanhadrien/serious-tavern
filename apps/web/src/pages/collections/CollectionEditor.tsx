import { EditorHeader } from '../../components/EditorHeader.js';
import type { CollectionDraft, EntryDraft } from './collectionDraft.js';
import { CollectionEntryList } from './CollectionEntryList.js';

interface CollectionEditorProps {
  draft: CollectionDraft;
  dirty: boolean;
  /** A save is in flight: Save is disabled, so a second click never sends another. */
  saving?: boolean;
  /** Problems found when saving, shown above the form. */
  errors: readonly string[];
  /** The expanded entry. */
  selected?: number;
  /** One stable id per entry, for dragging. */
  entryIds: readonly string[];
  onChange(draft: CollectionDraft): void;
  onSelect(index: number | undefined): void;
  onEntryChange(index: number, patch: Partial<EntryDraft>): void;
  onAddEntry(): void;
  onRemoveEntry(index: number): void;
  onMoveEntry(from: number, to: number): void;
  onSave(): void;
  /** Back to what is on disk (re-read, see `useCollectionEditor`). */
  onRevert(): void;
  onDelete(): void;
  onBack(): void;
}

/** The collection form shown in R in place of the collections list. */
export function CollectionEditor(props: CollectionEditorProps) {
  const { draft, dirty, errors, onChange } = props;
  return (
    <section className="collection-editor">
      <EditorHeader
        title={draft.name.trim() || 'Collection'}
        back={{ label: 'Back to collections', onClick: props.onBack }}
        dirty={dirty}
        actions={{
          save: { onClick: props.onSave, disabled: !dirty || props.saving },
          revert: { onClick: props.onRevert },
          remove: { onClick: props.onDelete },
        }}
      />
      {errors.length > 0 && (
        <ul className="collection-errors error" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <div className="collection-form">
        <label>
          Name
          <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        </label>
        <label>
          Description
          <textarea
            rows={2}
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
          />
        </label>
        <CollectionEntryList
          entries={draft.entries}
          selected={props.selected}
          ids={props.entryIds}
          onSelect={props.onSelect}
          onChange={props.onEntryChange}
          onAdd={props.onAddEntry}
          onRemove={props.onRemoveEntry}
          onMove={props.onMoveEntry}
        />
      </div>
    </section>
  );
}
