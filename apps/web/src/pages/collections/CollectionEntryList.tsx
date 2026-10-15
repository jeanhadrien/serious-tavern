import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { entryPreview, listFromText, type EntryDraft } from './collectionDraft.js';
import { CollectionEntryForm } from './CollectionEntryForm.js';

interface CollectionEntryListProps {
  entries: readonly EntryDraft[];
  /** The expanded entry. */
  selected?: number;
  onSelect(index: number | undefined): void;
  onChange(index: number, patch: Partial<EntryDraft>): void;
  onAdd(): void;
  onRemove(index: number): void;
  onMove(index: number, offset: number): void;
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

/** The entries as an accordion: one row each, the selected one expanded into its form. */
export function CollectionEntryList({ entries, selected, ...props }: CollectionEntryListProps) {
  return (
    <section className="collection-entries" aria-label="Entries">
      <div className="toolbar">
        <h2>Entries ({entries.length})</h2>
        <button type="button" onClick={props.onAdd}>
          + Add entry
        </button>
      </div>
      {!entries.length && <p className="hint">No entries yet.</p>}
      <ol>
        {entries.map((entry, index) => {
          const open = selected === index;
          const Chevron = open ? ChevronDown : ChevronRight;
          return (
            // Entries have no stable id: their position is their identity, here as on the server.
            <li key={index} className={`collection-entry ${open ? 'open' : ''} ${entry.enabled ? '' : 'disabled'}`}>
              <div className="collection-entry-row">
                <button
                  type="button"
                  className="collection-entry-toggle"
                  aria-expanded={open}
                  onClick={() => props.onSelect(open ? undefined : index)}
                >
                  <Chevron size={16} aria-hidden="true" />
                  <span className="collection-entry-preview">{entryPreview(entry)}</span>
                  {badges(entry).map((badge) => (
                    <small key={badge} className="collection-badge">
                      {badge}
                    </small>
                  ))}
                </button>
                <IconButton
                  icon={ArrowUp}
                  label="Move entry up"
                  disabled={index === 0}
                  onClick={() => props.onMove(index, -1)}
                />
                <IconButton
                  icon={ArrowDown}
                  label="Move entry down"
                  disabled={index === entries.length - 1}
                  onClick={() => props.onMove(index, 1)}
                />
                <IconButton icon={Trash2} label="Delete entry" onClick={() => props.onRemove(index)} />
              </div>
              {open && <CollectionEntryForm entry={entry} onChange={(patch) => props.onChange(index, patch)} />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
