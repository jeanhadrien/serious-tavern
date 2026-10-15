import { memo } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { entryPreview, listFromText, type EntryDraft } from './collectionDraft.js';
import { CollectionEntryForm } from './CollectionEntryForm.js';

/** What a row does; the editor keeps these stable, so a row re-renders only when its own entry changes. */
interface EntryActions {
  onSelect(index: number | undefined): void;
  onChange(index: number, patch: Partial<EntryDraft>): void;
  onRemove(index: number): void;
  onMove(index: number, offset: number): void;
}

interface CollectionEntryListProps extends EntryActions {
  entries: readonly EntryDraft[];
  /** The expanded entry. */
  selected?: number;
  onAdd(): void;
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

interface EntryRowProps extends EntryActions {
  entry: EntryDraft;
  index: number;
  open: boolean;
  last: boolean;
}

// Memoized: large lorebooks have hundreds of rows, and typing elsewhere must not re-render them all.
const EntryRow = memo(function EntryRow({ entry, index, open, last, ...actions }: EntryRowProps) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const facts = badges(entry);
  return (
    <li className={`collection-entry ${open ? 'open' : ''} ${entry.enabled ? '' : 'disabled'}`}>
      <div className="collection-entry-row">
        <button
          type="button"
          className="collection-entry-toggle"
          aria-expanded={open}
          onClick={() => actions.onSelect(open ? undefined : index)}
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
        <IconButton
          icon={ArrowUp}
          label="Move entry up"
          disabled={index === 0}
          onClick={() => actions.onMove(index, -1)}
        />
        <IconButton icon={ArrowDown} label="Move entry down" disabled={last} onClick={() => actions.onMove(index, 1)} />
        <IconButton icon={Trash2} label="Delete entry" onClick={() => actions.onRemove(index)} />
      </div>
      {open && <CollectionEntryForm entry={entry} onChange={(patch) => actions.onChange(index, patch)} />}
    </li>
  );
});

/** The entries as an accordion: one row each, the selected one expanded into its form. */
export function CollectionEntryList({ entries, selected, onAdd, ...actions }: CollectionEntryListProps) {
  return (
    <section className="collection-entries" aria-label="Entries">
      <div className="toolbar">
        <h2>Entries ({entries.length})</h2>
        <button type="button" onClick={onAdd}>
          + Add entry
        </button>
      </div>
      {!entries.length && <p className="hint">No entries yet.</p>}
      <ol>
        {entries.map((entry, index) => (
          // Entries have no stable id: their position is their identity, here as on the server.
          <EntryRow
            key={index}
            entry={entry}
            index={index}
            open={selected === index}
            last={index === entries.length - 1}
            {...actions}
          />
        ))}
      </ol>
    </section>
  );
}
