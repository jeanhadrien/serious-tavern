import type { NodeConfigPanelProps } from './types.js';
import { CollectionPicker } from './CollectionPicker.js';
import { DraftInput } from './DraftInput.js';
import { escapeSeparator, parseCount, unescapeSeparator } from './collectionConfig.js';

export function RecallPanel({ descriptor, config, onChange, context }: NodeConfigPanelProps) {
  const value = (key: string) => config[key] ?? descriptor.defaultConfig[key];
  const set = (key: string, next: unknown) => onChange({ ...config, [key]: next });
  const count = (key: string, label: string, min: number, hint?: string) => (
    <DraftInput
      label={label}
      value={Number(value(key) ?? min)}
      format={String}
      parse={(text) => parseCount(text, min)}
      onCommit={(next) => set(key, next)}
      hint={hint}
    />
  );
  return (
    <div className="config-fields">
      <CollectionPicker
        ids={value('collectionIds')}
        onChange={(ids) => set('collectionIds', ids)}
        context={context}
        ordered
      />
      <p className="hint">Matches come out in collection order. Entries without keywords are never recalled.</p>
      {count('scanMessages', 'Scan messages', 0, 'Recent history messages to scan, besides the current message.')}
      {count('maxEntries', 'Max entries', 1)}
      {count('maxChars', 'Max characters', 0, '0 = no limit. Stops at the first entry that does not fit.')}
      <label className="check">
        <input
          type="checkbox"
          checked={value('caseSensitive') === true}
          onChange={(event) => set('caseSensitive', event.target.checked)}
        />
        Case sensitive
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={value('wholeWords') !== false}
          onChange={(event) => set('wholeWords', event.target.checked)}
        />
        Whole words only
      </label>
      <DraftInput
        label="Separator"
        value={String(value('separator') ?? '\n\n')}
        format={escapeSeparator}
        parse={unescapeSeparator}
        onCommit={(next) => set('separator', next)}
        hint={
          <>
            Between entries in the text output; <code>\n</code> is a new line.
          </>
        }
      />
    </div>
  );
}
