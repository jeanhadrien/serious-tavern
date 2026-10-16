import type { NodeConfigPanelProps } from './types.js';
import { StateKeyPicker } from './StateKeyPicker.js';

const READS = [
  { value: 'value', label: 'Its value' },
  { value: 'meta', label: 'When it was written' },
];

/** State Read: pick the key, and whether to read its value or facts about when it was written. */
export function StateReadPanel({ descriptor, config, onChange, context }: NodeConfigPanelProps) {
  const read = String(config.read ?? descriptor.defaultConfig.read ?? 'value');
  const known = READS.some((option) => option.value === read);
  return (
    <div className="config-fields">
      <StateKeyPicker kind="read" config={config} onChange={onChange} context={context} />
      <label className="state-field">
        Read
        <select value={read} onChange={(event) => onChange({ ...config, read: event.target.value })}>
          {!known && <option value={read}>Unknown read ({read})</option>}
          {READS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Its value is what the chat held when the turn started (the key's default when nothing was written); this turn's
        writes are not visible yet. When it was written gives Written, Turns since write and Written at turn, and a
        Count for a list.
      </p>
    </div>
  );
}
