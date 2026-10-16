import { useEffect, useState, type ReactNode } from 'react';

interface DraftInputProps<T> {
  label: string;
  /** The stored config value. */
  value: T;
  format(value: T): string;
  /** The value a text stands for, or undefined while it isn't valid (nothing is committed then). */
  parse(text: string): T | undefined;
  onCommit(value: T): void;
  hint?: ReactNode;
  /** A text box with several lines (JSON, longer text). */
  multiline?: boolean;
  /** Shown while the typed text is not valid (`parse` gives undefined); the text stays editable meanwhile. */
  invalid?: ReactNode;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A text field over a parsed config value. It keeps what is typed (a trailing comma, a cleared number) and
 * commits only valid values, so typing never fights the stored value. It follows the value when it changes
 * from outside, and on blur an invalid text goes back to the stored value.
 */
export function DraftInput<T>({
  label,
  value,
  format,
  parse,
  onCommit,
  hint,
  multiline = false,
  invalid,
}: DraftInputProps<T>) {
  const [text, setText] = useState(() => format(value));
  useEffect(() => {
    setText((current) => (same(parse(current), value) ? current : format(value)));
  }, [JSON.stringify(value)]);
  const change = (next: string) => {
    setText(next);
    const parsed = parse(next);
    if (parsed !== undefined && !same(parsed, value)) onCommit(parsed);
  };
  const blur = () => {
    if (parse(text) === undefined) setText(format(value));
  };
  return (
    <label>
      {label}
      {multiline ? (
        <textarea
          rows={5}
          spellCheck={false}
          value={text}
          onChange={(event) => change(event.target.value)}
          onBlur={blur}
        />
      ) : (
        <input value={text} onChange={(event) => change(event.target.value)} onBlur={blur} />
      )}
      {invalid && parse(text) === undefined && (
        <small className="error" role="alert">
          {invalid}
        </small>
      )}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}
