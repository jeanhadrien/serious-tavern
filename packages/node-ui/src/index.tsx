import type { ChangeEvent } from 'react';
import type { NodeTypeDescriptor } from '@st/shared';

type Props = { descriptor: NodeTypeDescriptor; config: Record<string, unknown>; onChange(config: Record<string, unknown>): void };
type Field = { type?: string; enum?: unknown[]; default?: unknown; description?: string; items?: { properties?: Record<string, Field> } };
function GenericPanel({ descriptor, config, onChange }: Props) {
  const fields = (descriptor.configSchema.properties ?? {}) as Record<string, Field>;
  const update = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  return <div className="config-fields">{Object.entries(fields).map(([key, field]) => {
    const value = config[key] ?? field.default ?? '';
    const label = key.replace(/([A-Z])/g, ' $1');
    if (field.type === 'array') {
      const rows = (Array.isArray(value) ? value : []) as { key: string; value: string }[];
      return <label key={key}>{label}<div className="kv-list">{rows.map((row, i) =>
        <div className="kv-row" key={i}><input aria-label={`${key} key ${i}`} placeholder="Key" value={row.key}
          onChange={e => update(key, rows.map((r, j) => j === i ? { ...r, key: e.target.value } : r))} />
          <input aria-label={`${key} value ${i}`} placeholder="Value" value={row.value}
            onChange={e => update(key, rows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))} />
          <button type="button" onClick={() => update(key, rows.filter((_, j) => j !== i))}>×</button></div>)}
        <button type="button" onClick={() => update(key, [...rows, { key: '', value: '' }])}>+ Add row</button></div></label>;
    }
    if (field.type === 'boolean') return <label className="check" key={key}><input type="checkbox" checked={Boolean(value)}
      onChange={e => update(key, e.target.checked)} />{label}</label>;
    if (field.enum) return <label key={key}>{label}<select value={String(value)} onChange={e => update(key, e.target.value)}>
      {field.enum.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select></label>;
    if (field.type === 'number' || field.type === 'integer') return <label key={key}>{label}<input type="number"
      value={String(value)} onChange={e => update(key, Number(e.target.value))} /></label>;
    const multiline = /template|prompt|body|system|left|right/i.test(key);
    const input = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(key, e.target.value);
    return <label key={key}>{label}{multiline ? <textarea rows={4} value={String(value)} onChange={input} /> :
      <input value={String(value)} onChange={input} />}</label>;
  })}</div>;
}
function ConditionPanel(props: Props) {
  return <><p className="hint">Route the input value through the true or false output. Templates accept {'{{input.value}}'} and {'{{trigger.message}}'}.</p>
    <GenericPanel {...props} /></>;
}
// Optional overrides are registered only here; all other node types use the schema-driven form.
export const customPanels: Record<string, (props: Props) => React.JSX.Element> = { condition: ConditionPanel };
export function NodeConfigPanel(props: Props) {
  const Panel = customPanels[props.descriptor.type] ?? GenericPanel;
  return <Panel {...props} />;
}
