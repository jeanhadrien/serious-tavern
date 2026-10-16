import type { CollectionKeyDef, StateKeyDef, StateNodeOp } from '@st/shared';
import { DraftInput } from './DraftInput.js';
import {
  boundsHint,
  fixedValueProblem,
  itemParts,
  itemValue,
  parseNumber,
  parseObject,
  valueKind,
} from './stateValue.js';

interface StateValueEditorProps {
  def: StateKeyDef;
  op: StateNodeOp;
  /** The node's fixed value; undefined when it has none. */
  value: unknown;
  /** The new fixed value; undefined removes the setting. */
  onChange(value: unknown | undefined): void;
}

/** A value as the text of a number box: what is stored, even when it is not a number. */
const numberText = (value: unknown) => (value === undefined || value === null ? '' : String(value));
const objectText = (value: unknown) =>
  value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);

/** `none` | true | false as a select value, and back. */
const boolText = (value: unknown) => (value === true ? 'true' : value === false ? 'false' : '');
const readBool = (text: string) => (text === 'true' ? true : text === 'false' ? false : undefined);

function BoolSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange(value: boolean | undefined): void;
}) {
  return (
    <label className="state-field">
      {label}
      <select value={boolText(value)} onChange={(event) => onChange(readBool(event.target.value))}>
        <option value="">No fixed value</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    </label>
  );
}

function ItemEditor({
  def,
  value,
  onChange,
}: {
  def: CollectionKeyDef;
  value: unknown;
  onChange(value: unknown): void;
}) {
  const parts = itemParts(value, def);
  const change = (next: Partial<typeof parts>) =>
    onChange(itemValue({ ...parts, ...next, fields: { ...parts.fields, ...next.fields } }, def, value));
  const field = (name: string, type: 'text' | 'number' | 'boolean') => {
    const current = parts.fields[name];
    const label = `${name} (${type})`;
    if (type === 'boolean')
      return (
        <BoolSelect
          key={name}
          label={label}
          value={current}
          onChange={(next) => change({ fields: { [name]: next } })}
        />
      );
    if (type === 'number')
      return (
        <DraftInput<unknown>
          key={name}
          label={label}
          value={current}
          format={numberText}
          parse={(text) => parseNumber(text)}
          onCommit={(next) => change({ fields: { [name]: next ?? undefined } })}
          invalid="Not a number"
        />
      );
    return (
      <label key={name} className="state-field">
        {label}
        <input
          value={typeof current === 'string' ? current : numberText(current)}
          onChange={(event) => change({ fields: { [name]: event.target.value } })}
        />
      </label>
    );
  };
  return (
    <>
      <label className="state-field">
        Item text
        <textarea rows={2} value={parts.text} onChange={(event) => change({ text: event.target.value })} />
      </label>
      <div className="state-item-fields">
        {Object.entries(def.fields ?? {}).map(([name, type]) => field(name, type))}
      </div>
    </>
  );
}

/** The typed editor of State Write's fixed value: one control for the key's type and the chosen operation. */
export function StateValueEditor({ def, op, value, onChange }: StateValueEditorProps) {
  const kind = valueKind(def, op);
  const problem = fixedValueProblem(def, op, value);
  const control = () => {
    switch (kind) {
      case 'none':
        return <p className="hint">This operation needs no value.</p>;
      case 'number':
      case 'amount':
        return (
          <DraftInput<unknown>
            label={kind === 'amount' ? 'Amount' : 'Fixed value'}
            value={value}
            format={numberText}
            parse={parseNumber}
            onCommit={(next) => onChange(next ?? undefined)}
            invalid="Not a number"
            hint={
              <>
                {kind === 'amount' ? 'Left blank, it adds 1. Negative numbers subtract. ' : ''}
                {boundsHint(def)}
              </>
            }
          />
        );
      case 'boolean':
        return <BoolSelect label="Fixed value" value={value} onChange={onChange} />;
      case 'enum': {
        const options = def.type === 'enum' ? def.options : [];
        const foreign = typeof value === 'string' && !options.includes(value);
        return (
          <label className="state-field">
            Fixed value
            <select
              value={typeof value === 'string' ? value : ''}
              onChange={(event) => onChange(event.target.value || undefined)}
            >
              <option value="">No fixed value</option>
              {foreign && <option value={value}>(not an option) {value}</option>}
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        );
      }
      case 'text':
        return (
          <label className="state-field">
            Fixed value
            <textarea
              rows={3}
              value={typeof value === 'string' ? value : numberText(value)}
              onChange={(event) => onChange(event.target.value || undefined)}
            />
          </label>
        );
      case 'object':
        return (
          <DraftInput<unknown>
            label="Fixed value (JSON object)"
            multiline
            value={value}
            format={objectText}
            parse={parseObject}
            onCommit={(next) => onChange(next ?? undefined)}
            invalid="Not a JSON object"
          />
        );
      case 'item':
        return def.type === 'collection' ? <ItemEditor def={def} value={value} onChange={onChange} /> : null;
      case 'itemId':
        return (
          <label className="state-field">
            Item id
            <input
              value={typeof value === 'string' ? value : numberText(value)}
              onChange={(event) => onChange(event.target.value || undefined)}
            />
          </label>
        );
    }
  };
  return (
    <div className="config-field state-value">
      {control()}
      {problem && (
        <small className="error" role="alert">
          {problem}
        </small>
      )}
    </div>
  );
}
