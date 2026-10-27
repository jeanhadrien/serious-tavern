import { useRef, type ChangeEvent } from 'react';
import { macroHints, stateHints } from '@st/shared';
import type { NodeConfigPanelProps as Props } from './panels/types.js';
import { CharacterPanel } from './panels/character.js';
import { LlmPanel } from './panels/llm.js';
import { RecallPanel } from './panels/recall.js';
import { DrawPanel } from './panels/draw.js';
import { TriggerPanel } from './panels/trigger.js';
import { StateKeyPicker } from './panels/StateKeyPicker.js';
import { StateReadPanel } from './panels/stateRead.js';
import { StateWritePanel } from './panels/stateWrite.js';
import { supportsKeyValueArray, isKeyValueRows, numberFieldValue, type Field } from './fields.js';
import { templateFieldWarnings } from './templateFieldWarnings.js';
export type { NodePanelContext, NodeConfigPanelProps } from './panels/types.js';
export { nodeSummary } from './summaries.js';

/** `lead` is shown first; `hidden` fields are left to it (Next Chunk's key picker replaces the two id fields). */
function GenericPanel({
  descriptor,
  config,
  onChange,
  context,
  lead,
  hidden = [],
}: Props & { lead?: React.ReactNode; hidden?: readonly string[] }) {
  const configRef = useRef(config);
  configRef.current = config;
  const focused = useRef<{
    field: string;
    element: HTMLInputElement | HTMLTextAreaElement;
    update(value: string): void;
  } | null>(null);
  const fields = Object.fromEntries(
    Object.entries((descriptor.configSchema.properties ?? {}) as Record<string, Field>).filter(
      ([key]) => !hidden.includes(key),
    ),
  );
  const update = (key: string, value: unknown) => onChange({ ...configRef.current, [key]: value });
  const updateRow = (key: string, index: number, property: 'key' | 'value', value: string) => {
    const rows = (configRef.current[key] ?? []) as { key: string; value: string }[];
    update(
      key,
      rows.map((row, i) => (i === index ? { ...row, [property]: value } : row)),
    );
  };
  const variables = macroHints(
    descriptor.inputs.map((port) => ({ key: port.name, dataType: port.dataType })),
    context?.settings,
    context?.stateDefinitions && stateHints(context.stateDefinitions),
    context?.snippets,
  );
  const snippetNames = context?.snippets?.map((snippet) => snippet.name);
  const insert = (field: string, expression: string) => {
    const target = focused.current;
    if (target?.field === field && target.element.isConnected) {
      const start = target.element.selectionStart ?? target.element.value.length;
      const end = target.element.selectionEnd ?? start;
      target.update(target.element.value.slice(0, start) + expression + target.element.value.slice(end));
      requestAnimationFrame(() => {
        target.element.focus();
        target.element.setSelectionRange(start + expression.length, start + expression.length);
      });
    } else if (fields[field]?.type === 'array') {
      const rows = configRef.current[field] ?? [];
      if (supportsKeyValueArray(fields[field]) && isKeyValueRows(rows))
        update(field, [...rows, { key: '', value: expression }]);
    } else {
      update(field, `${String(configRef.current[field] ?? '')}${expression}`);
    }
  };
  const inputKeys = descriptor.inputs.map((port) => port.name);
  const hints = (key: string) => {
    if (!descriptor.templateFields?.includes(key)) return null;
    const warnings = templateFieldWarnings(config[key] ?? fields[key]?.default, inputKeys, snippetNames);
    return (
      <>
        {warnings.length > 0 && (
          <div className="template-warnings">
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
        <div className="template-hints">
          <small>Variables (click to insert):</small>
          {variables.map((variable) => (
            <button
              type="button"
              key={variable.expression}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(key, variable.expression)}
              title={`${variable.description} (${variable.type})`}
            >
              {variable.expression} <em>{variable.type}</em>
            </button>
          ))}
        </div>
      </>
    );
  };
  return (
    <div className="config-fields">
      {lead}
      {Object.entries(fields).map(([key, field]) => {
        const value = config[key] ?? field.default ?? '';
        const label = key.replace(/([A-Z])/g, ' $1');
        const help = field.description ? <small className="hint">{field.description}</small> : null;
        if (field.type === 'array') {
          const rows = config[key] === undefined ? (field.default ?? []) : config[key];
          if (!supportsKeyValueArray(field) || !isKeyValueRows(rows))
            return (
              <div className="config-field" key={key}>
                <span>{label}</span>
                <p className="hint">
                  Read-only: this array schema or value is not supported by the generic form. Use a custom panel to edit
                  it.
                </p>
                <pre>{JSON.stringify(rows, null, 2)}</pre>
              </div>
            );
          return (
            <div className="config-field" key={key}>
              <span>{label}</span>
              <div className="kv-list">
                {rows.map((row, i) => (
                  <div className="kv-row" key={i}>
                    <input
                      aria-label={`${key} key ${i}`}
                      placeholder="Key"
                      value={row.key}
                      onFocus={(e) => {
                        focused.current = {
                          field: key,
                          element: e.currentTarget,
                          update: (value) => updateRow(key, i, 'key', value),
                        };
                      }}
                      onChange={(e) => updateRow(key, i, 'key', e.target.value)}
                    />
                    <input
                      aria-label={`${key} value ${i}`}
                      placeholder="Value"
                      value={row.value}
                      onFocus={(e) => {
                        focused.current = {
                          field: key,
                          element: e.currentTarget,
                          update: (value) => updateRow(key, i, 'value', value),
                        };
                      }}
                      onChange={(e) => updateRow(key, i, 'value', e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        update(
                          key,
                          rows.filter((_, j) => j !== i),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => update(key, [...rows, { key: '', value: '' }])}>
                  + Add row
                </button>
              </div>
              {hints(key)}
            </div>
          );
        }
        if (field.type === 'boolean')
          return (
            <div className="config-field" key={key}>
              <label className="check">
                <input type="checkbox" checked={Boolean(value)} onChange={(e) => update(key, e.target.checked)} />
                {label}
              </label>
              {help}
            </div>
          );
        if (field.enum)
          return (
            <label key={key}>
              {label}
              <select value={String(value)} onChange={(e) => update(key, e.target.value)}>
                {field.enum.map((option) => (
                  <option key={String(option)} value={String(option)}>
                    {String(option)}
                  </option>
                ))}
              </select>
              {help}
            </label>
          );
        if (field.type === 'number' || field.type === 'integer')
          return (
            <label key={key}>
              {label}
              <input
                type="number"
                value={String(value)}
                onChange={(e) => update(key, numberFieldValue(e.target.value, field))}
              />
              {help}
            </label>
          );
        const multiline = /template|prompt|body|system|left|right/i.test(key);
        const input = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(key, e.target.value);
        const focus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          focused.current = { field: key, element: e.currentTarget, update: (value) => update(key, value) };
        };
        return (
          <div className="config-field" key={key}>
            <label>
              {label}
              {multiline ? (
                <textarea rows={4} value={String(value)} onFocus={focus} onChange={input} />
              ) : (
                <input value={String(value)} onFocus={focus} onChange={input} />
              )}
              {help}
            </label>
            {hints(key)}
          </div>
        );
      })}
    </div>
  );
}
function ConditionPanel(props: Props) {
  return (
    <>
      <p className="hint">Route the input value through the true or false output.</p>
      <GenericPanel {...props} />
    </>
  );
}
/** Next Chunk and Unlinked Messages: a list key of a state definition (the State Read picker), then the generic form. */
function CollectionKeyPanel(props: Props) {
  return (
    <GenericPanel
      {...props}
      hidden={['definitionId', 'key']}
      lead={
        <StateKeyPicker kind="collection" config={props.config} onChange={props.onChange} context={props.context} />
      }
    />
  );
}
/** Thread: a thread key of a state definition (the State Read picker), then the generic form. */
function ThreadPanel(props: Props) {
  return (
    <GenericPanel
      {...props}
      hidden={['definitionId', 'key']}
      lead={<StateKeyPicker kind="thread" config={props.config} onChange={props.onChange} context={props.context} />}
    />
  );
}
// Optional overrides are registered only here; all other node types use the schema-driven form.
export const customPanels: Record<string, (props: Props) => React.JSX.Element> = {
  condition: ConditionPanel,
  character: CharacterPanel,
  llm: LlmPanel,
  recall: RecallPanel,
  draw: DrawPanel,
  trigger: TriggerPanel,
  'state-read': StateReadPanel,
  'state-write': StateWritePanel,
  'next-chunk': CollectionKeyPanel,
  'unlinked-messages': CollectionKeyPanel,
  thread: ThreadPanel,
};
export function NodeConfigPanel(props: Props) {
  const Panel = customPanels[props.descriptor.type] ?? GenericPanel;
  return <Panel {...props} />;
}
