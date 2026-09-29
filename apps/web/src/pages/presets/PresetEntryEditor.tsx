import { useRef } from 'react';
import type { Preset, PresetEntry } from '@st/shared';

export function PresetEntryEditor(props: {
  preset: Preset;
  entry?: PresetEntry;
  onChange(entry: PresetEntry): void;
}) {
  const focusedContent = useRef<HTMLTextAreaElement | null>(null);
  const { entry, preset } = props;
  if (!entry) return <section className="preset-entry-detail empty-entry">
    <h3>Entry editor</h3><p>Select an entry from the message list, or add a new one.</p>
  </section>;

  const eligibleDepthInputs = preset.inputs.filter(input => input.enabled && input.dataType === 'messages' &&
    preset.entries.some(item => item.kind === 'input' && item.inputKey === input.key && item.enabled));
  const depthPlacement = entry.kind === 'message' && entry.placement.mode === 'depth' ? entry.placement : undefined;
  const update = (partial: Partial<PresetEntry>) => props.onChange({ ...entry, ...partial } as PresetEntry);
  const insertHint = (hint: string) => {
    if (entry.kind !== 'message') return;
    const candidate = focusedContent.current;
    const textarea = candidate?.dataset.entryId === entry.id ? candidate : null;
    const start = textarea?.selectionStart ?? entry.content.length;
    const end = textarea?.selectionEnd ?? start;
    props.onChange({ ...entry, content: entry.content.slice(0, start) + hint + entry.content.slice(end) });
    if (textarea) requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + hint.length, start + hint.length);
    });
  };

  return <section className="preset-entry-detail">
    <h3>Entry editor</h3>
    <label>Name <input value={entry.name} onChange={event => update({ name: event.target.value })} /></label>
    {entry.kind === 'input' ? <>
      <label>Input <select value={entry.inputKey} onChange={event =>
        update({ inputKey: event.target.value } as Partial<PresetEntry>)}>
        {preset.inputs.filter(input => input.enabled || input.key === entry.inputKey).map(input =>
          <option key={input.key} value={input.key}>{input.name} ({input.key}) · {input.dataType}</option>)}
        {!preset.inputs.some(input => input.key === entry.inputKey) &&
          <option value={entry.inputKey}>{entry.inputKey} · missing</option>}
      </select></label>
      <p className="hint">This entry inserts the selected input at this position. Input types and port names are managed in the middle column.</p>
      {preset.inputs.find(input => input.key === entry.inputKey)?.dataType === 'text' &&
        <label>Message role <select value={entry.role} onChange={event =>
          update({ role: event.target.value as 'system' | 'user' | 'assistant' })}>
          {['system', 'user', 'assistant'].map(role => <option key={role}>{role}</option>)}</select></label>}
    </> : <>
      <label>Role <select value={entry.role} onChange={event =>
        update({ role: event.target.value as 'system' | 'user' | 'assistant' })}>
        {['system', 'user', 'assistant'].map(role => <option key={role}>{role}</option>)}</select></label>
      <label>Content <textarea rows={8} data-entry-id={entry.id} value={entry.content}
        onFocus={event => { focusedContent.current = event.currentTarget; }}
        onBlur={() => { focusedContent.current = null; }}
        onChange={event => update({ content: event.target.value })} /></label>
      <div className="template-hints"><small>Variables (click to insert)</small>
        {['{{trigger.message}}', '{{trigger.sessionId}}', ...preset.inputs.filter(input => input.enabled)
          .map(input => `{{input.${input.key}}}`)].map(hint =>
          <button type="button" key={hint} onMouseDown={event => event.preventDefault()}
            onClick={() => insertHint(hint)}>{hint}</button>)}</div>
      <label>Placement <select value={entry.placement.mode} onChange={event => {
        if (event.target.value === 'ordered') update({ placement: { mode: 'ordered' } });
        else update({ placement: { mode: 'depth', inputKey: eligibleDepthInputs[0]?.key ?? '', depth: 0 } });
      }}><option value="ordered">Ordered list</option><option value="depth">Inside messages input</option></select></label>
      {depthPlacement && <>
        <label>Messages input <select value={depthPlacement.inputKey} onChange={event =>
          update({ placement: { mode: 'depth', inputKey: event.target.value, depth: depthPlacement.depth } })}>
          {eligibleDepthInputs.map(input =>
            <option value={input.key} key={input.key}>{input.name} ({input.key})</option>)}
          {!eligibleDepthInputs.some(input => input.key === depthPlacement.inputKey) &&
            <option value={depthPlacement.inputKey}>{depthPlacement.inputKey || 'Choose an input'}</option>}
        </select></label>
        <label>Depth from end <input type="number" min="0" step="1" value={depthPlacement.depth}
          onChange={event => update({ placement: { mode: 'depth', inputKey: depthPlacement.inputKey, depth: Number(event.target.value) } })} /></label>
        {!eligibleDepthInputs.length && <p className="preset-warning">Add and place an enabled messages input to use depth placement.</p>}
      </>}
    </>}
  </section>;
}
