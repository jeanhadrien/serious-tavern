import { parseOptions } from './keyFields.js';
import type { KeyDraft } from './definitionDraft.js';

interface KeyTypeFieldsProps {
  keyDraft: KeyDraft;
  /** Read by the accessible names ("Min of key 2"). */
  position: number;
  onChange(patch: Partial<KeyDraft>): void;
}

/** The fields that belong to a key's type: defaults and bounds, options, cap and item fields. */
export function KeyTypeFields({ keyDraft: key, position, onChange }: KeyTypeFieldsProps) {
  const of = (field: string) => `${field} of key ${position}`;
  const numberInput = (field: 'default' | 'min' | 'max', label: string) => (
    <label>
      {label}
      <input
        aria-label={of(label)}
        inputMode="decimal"
        spellCheck={false}
        value={key[field]}
        placeholder={field === 'default' ? '0' : 'none'}
        onChange={(event) => onChange({ [field]: event.target.value })}
      />
    </label>
  );
  switch (key.type) {
    case 'number':
      return (
        <div className="state-key-numbers">
          {numberInput('default', 'Default')}
          {numberInput('min', 'Min')}
          {numberInput('max', 'Max')}
        </div>
      );
    case 'boolean':
      return (
        <label>
          Default
          <select
            aria-label={of('Default')}
            value={key.default}
            onChange={(event) => onChange({ default: event.target.value })}
          >
            <option value="">Not set (false)</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
      );
    case 'enum': {
      const options = parseOptions(key.options);
      const foreign = key.default !== '' && !options.includes(key.default);
      return (
        <>
          <label>
            Options
            <textarea
              aria-label={of('Options')}
              rows={3}
              spellCheck={false}
              value={key.options}
              onChange={(event) => onChange({ options: event.target.value })}
            />
            <small>One per line.</small>
          </label>
          <label>
            Default
            <select
              aria-label={of('Default')}
              value={key.default}
              onChange={(event) => onChange({ default: event.target.value })}
            >
              <option value="">First option</option>
              {[...new Set(options)].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              {foreign && <option value={key.default}>(not an option) {key.default}</option>}
            </select>
          </label>
        </>
      );
    }
    case 'text':
      return (
        <label>
          Default
          <textarea
            aria-label={of('Default')}
            rows={2}
            value={key.default}
            placeholder="Empty"
            onChange={(event) => onChange({ default: event.target.value })}
          />
        </label>
      );
    case 'object':
      return (
        <label>
          Default (JSON object)
          <textarea
            aria-label={of('Default')}
            className="state-code"
            rows={4}
            spellCheck={false}
            value={key.default}
            placeholder="{}"
            onChange={(event) => onChange({ default: event.target.value })}
          />
        </label>
      );
    case 'collection':
      return (
        <>
          <label>
            Cap
            <input
              aria-label={of('Cap')}
              inputMode="numeric"
              spellCheck={false}
              value={key.cap}
              placeholder="no limit"
              onChange={(event) => onChange({ cap: event.target.value })}
            />
            <small>Only this many of the newest items are kept when read.</small>
            {key.cap.trim() !== '' && (
              <small className="state-info">
                If items in this list link to messages (such as summaries), a cap drops the oldest, and their messages
                reach the prompt raw again.
              </small>
            )}
          </label>
          <label>
            Item fields
            <textarea
              aria-label={of('Item fields')}
              className="state-code"
              rows={3}
              spellCheck={false}
              value={key.fields}
              placeholder="level:number"
              onChange={(event) => onChange({ fields: event.target.value })}
            />
            <small>One per line, name:type, type is text, number or boolean. id and text always exist.</small>
          </label>
        </>
      );
  }
}
