import { useRef, type ChangeEvent } from 'react';
import type { NodeTypeDescriptor } from '@st/shared';

type Props = { descriptor: NodeTypeDescriptor; config: Record<string, unknown>; onChange(config: Record<string, unknown>): void };
type Field = { type?: string; enum?: unknown[]; default?: unknown; description?: string; items?: { properties?: Record<string, Field> } };
function GenericPanel({ descriptor, config, onChange }: Props) {
  const configRef = useRef(config);
  configRef.current = config;
  const focused = useRef<{ field: string; element: HTMLInputElement | HTMLTextAreaElement;
    update(value: string): void } | null>(null);
  const fields = (descriptor.configSchema.properties ?? {}) as Record<string, Field>;
  const update = (key: string, value: unknown) => onChange({ ...configRef.current, [key]: value });
  const updateRow = (key: string, index: number, property: 'key' | 'value', value: string) => {
    const rows = (configRef.current[key] ?? []) as { key: string; value: string }[];
    update(key, rows.map((row, i) => i === index ? { ...row, [property]: value } : row));
  };
  const variables = [
    ...descriptor.inputs.map(port => ({ expression: `{{input.${port.name}}}`, type: port.dataType })),
    { expression: '{{trigger.message}}', type: 'text' },
    { expression: '{{trigger.sessionId}}', type: 'text' },
    { expression: '{{history}}', type: 'messages' }
  ];
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
      update(field, [...((configRef.current[field] ?? []) as unknown[]), { key: '', value: expression }]);
    } else {
      update(field, `${String(configRef.current[field] ?? '')}${expression}`);
    }
  };
  const hints = (key: string) => descriptor.templateFields?.includes(key) &&
    <div className="template-hints"><small>Variables (click to insert):</small>
      {variables.map(variable => <button type="button" key={variable.expression}
        onMouseDown={event => event.preventDefault()} onClick={() => insert(key, variable.expression)}
        title={`${variable.expression} (${variable.type})`}>
        {variable.expression} <em>{variable.type}</em></button>)}</div>;
  return <div className="config-fields">{Object.entries(fields).map(([key, field]) => {
    const value = config[key] ?? field.default ?? '';
    const label = key.replace(/([A-Z])/g, ' $1');
    if (field.type === 'array') {
      const rows = (Array.isArray(value) ? value : []) as { key: string; value: string }[];
      return <div className="config-field" key={key}><span>{label}</span><div className="kv-list">{rows.map((row, i) =>
        <div className="kv-row" key={i}><input aria-label={`${key} key ${i}`} placeholder="Key" value={row.key}
          onFocus={e => { focused.current = { field: key, element: e.currentTarget,
            update: value => updateRow(key, i, 'key', value) }; }}
          onChange={e => updateRow(key, i, 'key', e.target.value)} />
          <input aria-label={`${key} value ${i}`} placeholder="Value" value={row.value}
            onFocus={e => { focused.current = { field: key, element: e.currentTarget,
              update: value => updateRow(key, i, 'value', value) }; }}
            onChange={e => updateRow(key, i, 'value', e.target.value)} />
          <button type="button" onClick={() => update(key, rows.filter((_, j) => j !== i))}>×</button></div>)}
        <button type="button" onClick={() => update(key, [...rows, { key: '', value: '' }])}>+ Add row</button></div>
        {hints(key)}</div>;
    }
    if (field.type === 'boolean') return <label className="check" key={key}><input type="checkbox" checked={Boolean(value)}
      onChange={e => update(key, e.target.checked)} />{label}</label>;
    if (field.enum) return <label key={key}>{label}<select value={String(value)} onChange={e => update(key, e.target.value)}>
      {field.enum.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select></label>;
    if (field.type === 'number' || field.type === 'integer') return <label key={key}>{label}<input type="number"
      value={String(value)} onChange={e => update(key, Number(e.target.value))} /></label>;
    const multiline = /template|prompt|body|system|left|right/i.test(key);
    const input = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(key, e.target.value);
    const focus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      focused.current = { field: key, element: e.currentTarget, update: value => update(key, value) };
    };
    return <div className="config-field" key={key}><label>{label}
      {multiline ? <textarea rows={4} value={String(value)} onFocus={focus} onChange={input} /> :
        <input value={String(value)} onFocus={focus} onChange={input} />}</label>{hints(key)}</div>;
  })}</div>;
}
function ConditionPanel(props: Props) {
  return <><p className="hint">Route the input value through the true or false output.</p>
    <GenericPanel {...props} /></>;
}
// Optional overrides are registered only here; all other node types use the schema-driven form.
export const customPanels: Record<string, (props: Props) => React.JSX.Element> = { condition: ConditionPanel };
export function NodeConfigPanel(props: Props) {
  const Panel = customPanels[props.descriptor.type] ?? GenericPanel;
  return <Panel {...props} />;
}
