import { useRef } from 'react';
import { presetSchema, type Preset, type PresetEntry } from '@st/shared';

export function PresetEntryEditor(props: {
  preset: Preset;
  entry?: PresetEntry;
  onChange(entry: PresetEntry): void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { entry, preset } = props;
  if (!entry) return <section className="preset-entry-detail empty-entry">
    <h3>Entry editor</h3><p>Select an entry from the list, or add a new one.</p>
  </section>;

  const index = preset.entries.findIndex(item => item.id === entry.id);
  const parsed = presetSchema.safeParse(preset);
  const issues = parsed.success ? [] : parsed.error.issues.filter(issue =>
    issue.path[0] === 'entries' && issue.path[1] === index);
  const slots = preset.entries.filter((item): item is Extract<PresetEntry, { kind: 'slot' }> =>
    item.kind === 'slot' && item.enabled && preset.inputs.find(input =>
      input.key === item.inputKey)?.dataType === 'messages');
  const placement = entry.kind === 'message' ? entry.placement : undefined;
  const update = (partial: Partial<PresetEntry>) => props.onChange({ ...entry, ...partial } as PresetEntry);
  const insert = (token: string) => {
    if (entry.kind !== 'message') return;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? entry.content.length;
    const end = textarea?.selectionEnd ?? start;
    update({ content: entry.content.slice(0, start) + token + entry.content.slice(end) });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return <section className="preset-entry-detail">
    <h3>Edit entry</h3>
    <label>Name <input value={entry.name} onChange={event => update({ name: event.target.value })} /></label>
    <label className="check"><input type="checkbox" checked={entry.enabled}
      onChange={event => update({ enabled: event.target.checked })} />Enabled</label>
    {entry.kind === 'slot' ? <>
      <label>Input <select value={entry.inputKey} onChange={event => update({ inputKey: event.target.value } as Partial<PresetEntry>)}>
        {preset.inputs.map(input => <option value={input.key} key={input.id}>
          {input.label ?? input.key} ({input.key}) · {input.dataType}
        </option>)}
        {!preset.inputs.some(input => input.key === entry.inputKey) &&
          <option value={entry.inputKey}>{entry.inputKey} · missing</option>}
      </select></label>
      <p className="hint">This slot places the selected input at this position in the final message list.</p>
      {preset.inputs.find(input => input.key === entry.inputKey)?.dataType === 'text' &&
        <label>Role <select value={entry.role} onChange={event =>
          update({ role: event.target.value as 'system' | 'user' | 'assistant' })}>
          {['system', 'user', 'assistant'].map(role => <option key={role}>{role}</option>)}
        </select></label>}
    </> : <>
      <label>Role <select value={entry.role} onChange={event =>
        update({ role: event.target.value as 'system' | 'user' | 'assistant' })}>
        {['system', 'user', 'assistant'].map(role => <option key={role}>{role}</option>)}
      </select></label>
      <label>Content <textarea ref={textareaRef} rows={12} value={entry.content}
        onChange={event => update({ content: event.target.value })} /></label>
      <div className="template-hints"><small>Insert variable at cursor</small>
        {[...preset.inputs.map(input => `{{input.${input.key}}}`),
          '{{trigger.message}}', '{{trigger.sessionId}}', '{{char}}', '{{char.name}}', '{{char.description}}',
          '{{char.personality}}', '{{char.scenario}}', '{{char.first_mes}}', '{{char.mes_example}}',
          '{{char.system_prompt}}', '{{char.post_history_instructions}}', '{{user}}', '{{user.name}}',
          '{{user.description}}'].map(token =>
          <button type="button" key={token} onMouseDown={event => event.preventDefault()}
            onClick={() => insert(token)}>{token}</button>)}
      </div>
      <label>Placement <select value={placement?.mode ?? 'ordered'} onChange={event => {
        update({ placement: event.target.value === 'ordered'
          ? { mode: 'ordered' }
          : { mode: 'depth', entryId: slots[0]?.id ?? '', depth: 0 } });
      }}>
        <option value="ordered">Ordered</option><option value="depth">Inside a messages slot</option>
      </select></label>
      {placement?.mode === 'depth' && <>
        <label>Messages slot <select value={placement.entryId} onChange={event =>
          update({ placement: { ...placement, entryId: event.target.value } })}>
          {slots.map(slot => <option value={slot.id} key={slot.id}>
            {slot.name} · {slot.inputKey}
          </option>)}
          {!slots.some(slot => slot.id === placement.entryId) &&
            <option value={placement.entryId}>{placement.entryId || 'Choose a slot'}</option>}
        </select></label>
        <label>Depth from end <input type="number" min="0" step="1" value={placement.depth}
          onChange={event => update({ placement: { ...placement, depth: Number(event.target.value) } })} /></label>
        {slots.length === 0 && <p className="preset-warning">Add an enabled slot for a messages input to use depth placement.</p>}
      </>}
    </>}
    {issues.length > 0 && <div className="preset-warnings" role="alert">
      {issues.map((issue, issueIndex) => <p key={issueIndex}>{issue.message}</p>)}
    </div>}
  </section>;
}
