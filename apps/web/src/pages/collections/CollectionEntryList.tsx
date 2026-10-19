import { memo, useCallback } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { SortableList, type SortableRow } from '../../components/sortable/SortableList.js';
import { entryPreview, listFromText, type EntryDraft } from './collectionDraft.js';
import { CollectionEntryForm } from './CollectionEntryForm.js';

interface CollectionEntryListProps {
  entries: readonly EntryDraft[];
  /** One stable id per entry (see `useRowIds`). */
  ids: readonly string[];
  /** The expanded entry. */
  selected?: number;
  onAdd(): void;
  onSelect(index: number | undefined): void;
  onChange(index: number, patch: Partial<EntryDraft>): void;
  onRemove(index: number): void;
  onMove(from: number, to: number): void;
}

/** Small facts about an entry, shown next to its preview. */
function badges(entry: EntryDraft): string[] {
  const tags = listFromText(entry.tags, entry.original.tags)?.length ?? 0;
  const keywords = listFromText(entry.keywords, entry.original.keywords)?.length ?? 0;
  return [
    entry.level ? `L${entry.level}` : '',
    keywords ? `${keywords} keyword${keywords === 1 ? '' : 's'}` : '',
    tags ? `${tags} tag${tags === 1 ? '' : 's'}` : '',
    entry.enabled ? '' : 'disabled',
  ].filter(Boolean);
}

interface EntryRowProps {
  entry: EntryDraft;
  index: number;
  open: boolean;
  row: Pick<SortableRow, 'handle' | 'moveUp' | 'moveDown'>;
  onSelect(index: number | undefined): void;
  onChange(index: number, patch: Partial<EntryDraft>): void;
  onRemove(index: number): void;
}

// Memoized: large lorebooks have hundreds of rows, and typing elsewhere must not re-render them all.
const EntryRow = memo(function EntryRow({ entry, index, open, row, onSelect, onChange, onRemove }: EntryRowProps) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const facts = badges(entry);
  return (
    <>
      <div className="collection-entry-row">
        {row.handle}
        <button
          type="button"
          className="collection-entry-toggle"
          aria-expanded={open}
          onClick={() => onSelect(open ? undefined : index)}
        >
          <Chevron size={16} aria-hidden="true" />
          <span className="collection-entry-preview">{entryPreview(entry)}</span>
          {facts.length > 0 && (
            <span className="collection-entry-badges">
              {facts.map((badge) => (
                <small key={badge} className="collection-badge">
                  {badge}
                </small>
              ))}
            </span>
          )}
        </button>
        <IconButton icon={ArrowUp} label="Move entry up" disabled={!row.moveUp} onClick={row.moveUp} />
        <IconButton icon={ArrowDown} label="Move entry down" disabled={!row.moveDown} onClick={row.moveDown} />
        <IconButton icon={Trash2} label="Delete entry" onClick={() => onRemove(index)} />
      </div>
      {open && <CollectionEntryForm entry={entry} onChange={(patch) => onChange(index, patch)} />}
    </>
  );
});

const entryLabel = (entry: EntryDraft) => entryPreview(entry);

/** The entries as an accordion: one row each, the selected one expanded into its form. Rows reorder by drag. */
export function CollectionEntryList({
  entries,
  ids,
  selected,
  onAdd,
  onSelect,
  onChange,
  onRemove,
  onMove,
}: CollectionEntryListProps) {
  const renderItem = useCallback(
    (entry: EntryDraft, { index, ...row }: SortableRow) => (
      <EntryRow
        entry={entry}
        index={index}
        open={selected === index}
        row={row}
        onSelect={onSelect}
        onChange={onChange}
        onRemove={onRemove}
      />
    ),
    [selected, onSelect, onChange, onRemove],
  );
  return (
    <section className="collection-entries" aria-label="Entries">
      <div className="toolbar">
        <h2>Entries ({entries.length})</h2>
        <button type="button" onClick={onAdd}>
          + Add entry
        </button>
      </div>
      {!entries.length && <p className="hint">No entries yet.</p>}
      <SortableList
        as="ol"
        rowAs="li"
        items={entries}
        // Entries have no id of their own: the editor keeps one per position, moving it with the entry.
        getId={(_, index) => ids[index] as string}
        label={entryLabel}
        onMove={onMove}
        renderItem={renderItem}
        rowClassName={(entry, index) =>
          `collection-entry ${selected === index ? 'open' : ''} ${entry.enabled ? '' : 'disabled'}`
        }
      />
    </section>
  );
}
