import type { NodeConfigPanelProps } from './types.js';
import { CollectionPicker } from './CollectionPicker.js';
import { DraftInput } from './DraftInput.js';
import { formatList, parseCount, parseList } from './collectionConfig.js';

const LEVELS = [1, 2, 3, 4, 5];

export function DrawPanel({ descriptor, config, onChange, context }: NodeConfigPanelProps) {
  const value = (key: string) => config[key] ?? descriptor.defaultConfig[key];
  const set = (key: string, next: unknown) => onChange({ ...config, [key]: next });
  const tags = (key: string, label: string, hint: string) => (
    <DraftInput
      label={label}
      value={Array.isArray(value(key)) ? (value(key) as string[]) : []}
      format={formatList}
      parse={parseList}
      onCommit={(next) => set(key, next)}
      hint={hint}
    />
  );
  const level = (key: 'minLevel' | 'maxLevel', label: string) => (
    <label>
      {label}
      <select
        value={config[key] === undefined ? '' : String(config[key])}
        onChange={(event) => {
          const { [key]: _, ...rest } = config;
          onChange(event.target.value ? { ...rest, [key]: Number(event.target.value) } : rest);
        }}
      >
        <option value="">Any</option>
        {LEVELS.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="config-fields">
      <CollectionPicker ids={value('collectionIds')} onChange={(ids) => set('collectionIds', ids)} context={context} />
      <p className="hint">
        When nothing passes the filters, Entry, Text and Level are absent: a node that requires them is skipped, others
        run without them. Reason says why.
      </p>
      <DraftInput
        label="Count"
        value={Number(value('count') ?? 1)}
        format={String}
        parse={(text) => parseCount(text, 1)}
        onCommit={(next) => set('count', next)}
        hint="Entries to draw, never the same one twice."
      />
      {tags('requireTags', 'Require tags', 'Comma-separated; entries need all of them.')}
      {tags('anyTags', 'Any of tags', 'Entries need at least one of them (when set).')}
      {tags('excludeTags', 'Exclude tags', 'Entries with any of them are left out.')}
      {level('minLevel', 'Min level')}
      {level('maxLevel', 'Max level')}
      <p className="hint">Entries without a level are left out when a level filter is set.</p>
      <label className="check">
        <input
          type="checkbox"
          checked={value('useWeights') !== false}
          onChange={(event) => set('useWeights', event.target.checked)}
        />
        Use weights
      </label>
      <p className="hint">
        Off: every entry has the same chance. Weight 0 is never drawn. Connected Max level and Tags inputs override
        these settings.
      </p>
    </div>
  );
}
