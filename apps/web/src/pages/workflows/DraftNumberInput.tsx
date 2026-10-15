import { useState, type InputHTMLAttributes } from 'react';
import { optionalNumber } from './settingsDraft.js';

/**
 * A number typed as text. While focused the field keeps what was typed ("-", "1."), so a negative number can be
 * typed from its sign; a change is reported only when the text is a number, or empty for an `optional` field
 * (`undefined`). Out of focus it shows the value.
 */
export function DraftNumberInput({
  value,
  optional = false,
  onChange,
  ...rest
}: {
  value: number | undefined;
  optional?: boolean;
  onChange(value: number | undefined): void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const shown = value === undefined ? '' : String(value);
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={editing ? text : shown}
      onFocus={() => {
        setText(shown);
        setEditing(true);
      }}
      onChange={(event) => {
        setText(event.target.value);
        const next = optionalNumber(event.target.value);
        if (next !== undefined || optional) onChange(next);
      }}
      onBlur={() => setEditing(false)}
    />
  );
}
