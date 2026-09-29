import type { Preset, PresetEntry, PresetInput } from '@st/shared';

const newId = () => crypto.randomUUID();
const uniqueInputKey = (inputs: PresetInput[]) => {
  let index = 1;
  let key = 'context';
  while (inputs.some(input => input.key === key)) key = `context${++index}`;
  return key;
};
const newInput = (inputs: PresetInput[]): PresetInput => ({
  key: uniqueInputKey(inputs), name: 'Context', enabled: true, dataType: 'text'
});
const newMessage = (): PresetEntry => ({
  id: newId(), name: 'New message', kind: 'message', enabled: true, role: 'system', content: '',
  placement: { mode: 'ordered' }
});

export function PresetEditor(props: {
  preset: Preset;
  dirty: boolean;
  onChange(preset: Preset): void;
  onSave(): void;
  selectedEntryId: string;
  onSelectEntry(id: string): void;
}) {
  const updateInput = (index: number, change: Partial<PresetInput>) => {
    const input = props.preset.inputs[index];
    if (!input) return;
    const updated = { ...input, ...change };
    let entries = props.preset.entries;
    if (change.key && change.key !== input.key) entries = entries.map(entry => {
      if (entry.kind === 'input' && entry.inputKey === input.key) return { ...entry, inputKey: change.key! };
      if (entry.kind === 'message' && entry.placement.mode === 'depth' && entry.placement.inputKey === input.key)
        return { ...entry, placement: { ...entry.placement, inputKey: change.key! } };
      return entry;
    });
    if (change.dataType === 'text') entries = entries.map(entry =>
      entry.kind === 'message' && entry.placement.mode === 'depth' && entry.placement.inputKey === updated.key
        ? { ...entry, placement: { mode: 'ordered' } } : entry);
    if (change.enabled === false) entries = entries.map(entry => {
      if (entry.kind === 'input' && entry.inputKey === input.key) return { ...entry, enabled: false };
      if (entry.kind === 'message' && entry.placement.mode === 'depth' && entry.placement.inputKey === input.key)
        return { ...entry, enabled: false };
      return entry;
    });
    props.onChange({ ...props.preset, inputs: props.preset.inputs.map((item, i) => i === index ? updated : item), entries });
  };
  const removeInput = (input: PresetInput) => {
    const entries = props.preset.entries.flatMap(entry => {
      if (entry.kind === 'input' && entry.inputKey === input.key) return [];
      if (entry.kind === 'message' && entry.placement.mode === 'depth' && entry.placement.inputKey === input.key)
        return [{ ...entry, placement: { mode: 'ordered' as const } }];
      return [entry];
    });
    props.onChange({ ...props.preset, inputs: props.preset.inputs.filter(item => item.key !== input.key), entries });
  };
  const moveEntry = (index: number, direction: number) => {
    const target = index + direction;
    if (target < 0 || target >= props.preset.entries.length) return;
    const entries = [...props.preset.entries];
    [entries[index], entries[target]] = [entries[target]!, entries[index]!];
    props.onChange({ ...props.preset, entries });
  };
  const removeEntry = (entry: PresetEntry) => {
    props.onChange({ ...props.preset, entries: props.preset.entries.filter(item => item.id !== entry.id) });
    if (props.selectedEntryId === entry.id) props.onSelectEntry('');
  };
  const toggleEntry = (entry: PresetEntry, enabled: boolean) => {
    props.onChange({ ...props.preset, entries: props.preset.entries.map(item =>
      item.id === entry.id ? { ...item, enabled } : item) });
  };

  return <section className="preset-editor-column">
    <div className="editor-toolbar preset-toolbar">
      <input aria-label="Preset name" value={props.preset.name} onChange={event =>
        props.onChange({ ...props.preset, name: event.target.value })} />
      {props.dirty && <small>Unsaved changes</small>}
      <button className="primary" onClick={props.onSave}>Save</button>
    </div>
    <label>Description <input value={props.preset.description ?? ''} onChange={event =>
      props.onChange({ ...props.preset, description: event.target.value })} /></label>
    <div className="toolbar"><h3>Inputs</h3><button onClick={() => props.onChange({
      ...props.preset, inputs: [...props.preset.inputs, newInput(props.preset.inputs)]
    })}>+ Input</button></div>
    {!props.preset.inputs.length && <p className="hint">Add typed inputs to create ports on LLM nodes.</p>}
    {props.preset.inputs.map((input, index) => <div className="preset-input-card" key={input.key}>
      <div className="toolbar"><strong>{input.key}</strong><button title="Remove input" onClick={() => removeInput(input)}>×</button></div>
      <label>Name <input value={input.name} onChange={event => updateInput(index, { name: event.target.value })} /></label>
      <label>Key <input pattern="^[a-z][a-zA-Z0-9_]*$" value={input.key} onChange={event =>
        updateInput(index, { key: event.target.value })} /></label>
      <label>Type <select value={input.dataType} onChange={event => updateInput(index,
        { dataType: event.target.value as 'text' | 'messages' })}>
        <option value="text">Text</option><option value="messages">Messages</option></select></label>
      <label>Description <input value={input.description ?? ''} onChange={event =>
        updateInput(index, { description: event.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={input.enabled} onChange={event =>
        updateInput(index, { enabled: event.target.checked })} />Enabled input port</label>
    </div>)}
    <div className="toolbar"><h3>Message list</h3>
      <button onClick={() => {
        const entry = newMessage();
        props.onChange({ ...props.preset, entries: [...props.preset.entries, entry] });
        props.onSelectEntry(entry.id);
      }}>+ Message</button>
      <button onClick={() => {
        const candidate = props.preset.inputs.find(input => !props.preset.entries.some(entry =>
          entry.kind === 'input' && entry.inputKey === input.key));
        if (!candidate) return;
        const entry: PresetEntry = { id: newId(), name: candidate.name, kind: 'input', enabled: candidate.enabled,
          inputKey: candidate.key, role: 'user' };
        props.onChange({ ...props.preset, entries: [...props.preset.entries, entry] });
        props.onSelectEntry(entry.id);
      }}>+ Input entry</button>
    </div>
    {props.preset.entries.map((entry, index) => <div key={entry.id}
      className={`preset-entry-row ${props.selectedEntryId === entry.id ? 'selected' : ''}`}>
      <button className="preset-entry-select" onClick={() => props.onSelectEntry(entry.id)}>
        <span>{index + 1}. {entry.name || (entry.kind === 'input' ? entry.inputKey : 'Untitled')}</span>
        <small>{entry.kind === 'input' ? `Input · ${entry.inputKey}` : `${entry.role} message`}</small>
      </button>
      <label className="check" title="Enable this entry"><input type="checkbox" checked={entry.enabled}
        onChange={event => toggleEntry(entry, event.target.checked)} />On</label>
      <button title="Move up" disabled={index === 0} onClick={() => moveEntry(index, -1)}>↑</button>
      <button title="Move down" disabled={index === props.preset.entries.length - 1} onClick={() => moveEntry(index, 1)}>↓</button>
      <button title="Remove entry" onClick={() => removeEntry(entry)}>×</button>
    </div>)}
  </section>;
}
