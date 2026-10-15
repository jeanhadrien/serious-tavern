import { ArrowLeft } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
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
  onChange(draft: CollectionDraft): void;
  onSelect(index: number | undefined): void;
  onEntryChange(index: number, patch: Partial<EntryDraft>): void;
  onAddEntry(): void;
  onRemoveEntry(index: number): void;
  onMoveEntry(index: number, offset: number): void;
  onSave(): void;
  onDiscard(): void;
  onDelete(): void;
  onBack(): void;
}

/** The collection form shown in R in place of the collections list. */
export function CollectionEditor(props: CollectionEditorProps) {
  const { draft, dirty, errors, onChange } = props;
  return (
    <section className="collection-editor">
      <div className="collection-toolbar">
        <div className="collection-title">
          <IconButton icon={ArrowLeft} label="Back to collections" onClick={props.onBack} />
          <h1>{draft.name.trim() || 'Collection'}</h1>
          {dirty && <span className="dirty-dot">Unsaved</span>}
        </div>
        <div className="toolbar">
          {dirty && (
            <button type="button" onClick={props.onDiscard}>
              Discard
            </button>
          )}
          <button type="button" onClick={props.onDelete}>
            Delete
          </button>
          <button type="button" className="primary" disabled={!dirty || props.saving} onClick={props.onSave}>
            Save
          </button>
        </div>
      </div>
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
