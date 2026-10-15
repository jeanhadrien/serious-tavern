import { LEVELS, type EntryDraft } from './collectionDraft.js';

interface CollectionEntryFormProps {
  entry: EntryDraft;
  onChange(patch: Partial<EntryDraft>): void;
}

/** The fields of one entry. Lists and numbers are typed as text and checked on save. */
export function CollectionEntryForm({ entry, onChange }: CollectionEntryFormProps) {
  return (
    <div className="collection-entry-form">
      <label>
        Text
        <textarea rows={6} value={entry.text} onChange={(event) => onChange({ text: event.target.value })} />
      </label>
      <label>
        Title
        <input value={entry.title} onChange={(event) => onChange({ title: event.target.value })} />
      </label>
      <label>
        Keywords
        <input value={entry.keywords} onChange={(event) => onChange({ keywords: event.target.value })} />
        <small>Comma-separated. Recall adds the entry when one of them appears in recent messages.</small>
      </label>
      <label>
        Tags
        <input value={entry.tags} onChange={(event) => onChange({ tags: event.target.value })} />
        <small>Comma-separated. Draw filters entries by tag.</small>
      </label>
      <div className="collection-entry-numbers">
        <label>
          Level
          <select
            value={entry.level}
            onChange={(event) => onChange({ level: event.target.value as EntryDraft['level'] })}
          >
            <option value="">None</option>
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label>
          Weight
          <input
            inputMode="decimal"
            value={entry.weight}
            onChange={(event) => onChange({ weight: event.target.value })}
          />
          <small>Draw's relative chance; 0 = never drawn.</small>
        </label>
      </div>
      <label className="collection-entry-enabled">
        <input
          type="checkbox"
          checked={entry.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        Enabled
      </label>
    </div>
  );
}
