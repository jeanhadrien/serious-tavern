import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { presetSchema, type Preset, type PresetEntry, type PromptMessage } from '@st/shared';
import { api, getPresets, json, type SessionSummary } from '../api.js';
import { alerts } from '../alerts/index.js';

const id = () => crypto.randomUUID();
type Slot = Extract<PresetEntry, { kind: 'slot' }>;
const slotsOnly = (item: PresetEntry): item is Slot => item.kind === 'slot';
const entry = (kind: 'slot' | 'message'): PresetEntry => kind === 'slot' ?
  { id: id(), kind, name: 'Context', enabled: true, key: 'context', dataType: 'text', role: 'user' } :
  { id: id(), kind, name: 'New message', enabled: true, role: 'system', content: '', placement: { mode: 'ordered' } };

export function Presets() {
  const [params] = useSearchParams();
  const [list, setList] = useState<Preset[]>([]);
  const [draft, setDraft] = useState<Preset>();
  const [saved, setSaved] = useState('');
  const [preview, setPreview] = useState<PromptMessage[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<string[]>([]);
  const refresh = async () => setList(await getPresets());
  useEffect(() => {
    void refresh().catch(() => {});
    void api<SessionSummary[]>('/sessions').then(setSessions).catch(() => {});
  }, []);
  useEffect(() => {
    const preset = list.find(item => item.id === params.get('id'));
    if (preset && !draft) choose(preset);
  }, [list, params, draft]);
  const choose = (preset: Preset) => { setDraft(structuredClone(preset)); setSaved(JSON.stringify(preset)); setPreview([]); setIssues([]); };
  const change = (next: Preset) => { setDraft(next); setIssues([]); };
  const create = async () => {
    try {
      const created = await api<Preset>('/presets', json('POST', { name: 'New preset', entries: [] }));
      await refresh(); choose(created);
    } catch { /* API errors are toasted. */ }
  };
  const save = async () => {
    if (!draft) return;
    const parsed = presetSchema.safeParse(draft);
    if (!parsed.success) { setIssues(parsed.error.issues.map(item => `${item.path.join('.')}: ${item.message}`)); return; }
    try {
      const result = await api<Preset>(`/presets/${draft.id}`, json('PUT', draft));
      choose(result); await refresh(); alerts.success('Preset saved');
    } catch { /* API errors are toasted. */ }
  };
  const duplicate = async (preset: Preset) => {
    try {
      const copy = await api<Preset>('/presets', json('POST', { ...preset, name: `${preset.name} copy`,
        entries: preset.entries.map(item => ({ ...item, id: id() })) }));
      await refresh(); choose(copy); alerts.success('Preset duplicated');
    } catch { /* API errors are toasted. */ }
  };
  const remove = async (preset: Preset) => {
    if (!window.confirm(`Delete ${preset.name}?`)) return;
    try {
      await api(`/presets/${preset.id}`, json('DELETE'));
      if (draft?.id === preset.id) { setDraft(undefined); setPreview([]); }
      await refresh();
    } catch { /* In-use errors are toasted automatically. */ }
  };
  const updateEntry = (index: number, next: PresetEntry) => {
    if (!draft) return;
    change({ ...draft, entries: draft.entries.map((item, i) => i === index ? next : item) });
  };
  const move = (index: number, direction: number) => {
    if (!draft || index + direction < 0 || index + direction >= draft.entries.length) return;
    const entries = [...draft.entries];
    [entries[index], entries[index + direction]] = [entries[index + direction]!, entries[index]!];
    change({ ...draft, entries });
  };
  const showPreview = async () => {
    if (!draft) return;
    const parsed = presetSchema.safeParse(draft);
    if (!parsed.success) { setIssues(parsed.error.issues.map(item => `${item.path.join('.')}: ${item.message}`)); return; }
    try {
      const result = await api<{ messages: PromptMessage[] }>('/presets/preview',
        json('POST', { preset: draft, slots: samples, ...(sessionId ? { sessionId } : {}) }));
      setPreview(result.messages); setIssues([]);
    } catch { /* API errors are toasted. */ }
  };
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  return <div className="workflow-layout"><aside className="sidebar"><div className="toolbar"><h2>Presets</h2>
    <button className="primary" onClick={() => void create()}>+ New</button></div>
    {list.map(preset => <div className={`session-row ${draft?.id === preset.id ? 'selected' : ''}`} key={preset.id}>
      <button className="session-link" onClick={() => choose(preset)}>{preset.name}</button>
      <button title="Duplicate preset" onClick={() => void duplicate(preset)}>⧉</button>
      <button title="Delete preset" onClick={() => void remove(preset.id === draft?.id ? draft : preset)}>×</button>
    </div>)}</aside>
    {draft ? <div className="preset-editor"><div className="editor-toolbar">
      <input aria-label="Preset name" value={draft.name} onChange={event => change({ ...draft, name: event.target.value })} />
      {dirty && <small>Unsaved changes</small>}
      <button className="primary" onClick={() => void save()}>Save</button></div>
      <label>Description <input value={draft.description ?? ''} onChange={event => change({ ...draft, description: event.target.value })} /></label>
      {issues.map((issue, index) => <p className="preset-error" key={index}>{issue}</p>)}
      <div className="toolbar"><h3>Entries</h3><button onClick={() => change({ ...draft, entries: [...draft.entries, entry('message')] })}>+ Message</button>
        <button onClick={() => change({ ...draft, entries: [...draft.entries, entry('slot')] })}>+ Slot</button></div>
      {draft.entries.map((item, index) => <section className="preset-entry" key={item.id}>
        <div className="toolbar"><strong>{item.kind === 'slot' ? 'Slot' : 'Message'} {index + 1}</strong>
          <button title="Move up" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
          <button title="Move down" disabled={index === draft.entries.length - 1} onClick={() => move(index, 1)}>↓</button>
          <button title="Remove entry" onClick={() => change({ ...draft, entries: draft.entries.filter((_, i) => i !== index) })}>×</button></div>
        <label className="check"><input type="checkbox" checked={item.enabled}
          onChange={event => updateEntry(index, { ...item, enabled: event.target.checked })} />Enabled</label>
        <label>Name <input value={item.name} onChange={event => updateEntry(index, { ...item, name: event.target.value })} /></label>
        {item.kind === 'slot' ? <>
          <label>Key <input pattern="^[a-z][a-zA-Z0-9_]*$" value={item.key}
            onChange={event => updateEntry(index, { ...item, key: event.target.value })} /></label>
          <label>Type <select value={item.dataType} onChange={event => updateEntry(index,
            { ...item, dataType: event.target.value as 'text' | 'messages' })}>
            <option value="text">Text</option><option value="messages">Messages</option></select></label>
          {item.dataType === 'text' && <label>Role <select value={item.role} onChange={event => updateEntry(index,
            { ...item, role: event.target.value as 'system' | 'user' | 'assistant' })}>
            {['system', 'user', 'assistant'].map(role => <option key={role}>{role}</option>)}</select></label>}
        </> : <>
          <label>Role <select value={item.role} onChange={event => updateEntry(index,
            { ...item, role: event.target.value as 'system' | 'user' | 'assistant' })}>
            {['system', 'user', 'assistant'].map(role => <option key={role}>{role}</option>)}</select></label>
          <label>Content <textarea rows={4} value={item.content} onChange={event => updateEntry(index, { ...item, content: event.target.value })} /></label>
          <div className="template-hints"><small>Variables (click to insert):</small>
            {['{{trigger.message}}', '{{trigger.sessionId}}', ...draft.entries.filter(slotsOnly)
              .map(candidate => `{{input.${candidate.key}}}`)].map(hint =>
              <button type="button" key={hint} onClick={() => updateEntry(index, { ...item, content: item.content + hint })}>{hint}</button>)}</div>
          <label>Placement <select value={item.placement.mode} onChange={event => updateEntry(index, {
            ...item, placement: event.target.value === 'ordered' ? { mode: 'ordered' } :
              { mode: 'depth', slot: draft.entries.filter(slotsOnly).find(candidate => candidate.enabled &&
                candidate.dataType === 'messages')?.key ?? '', depth: 0 }
          })}><option value="ordered">Ordered</option><option value="depth">In-chat at depth</option></select></label>
          {item.placement.mode === 'depth' && <>
            <label>Messages slot <select value={item.placement.slot} onChange={event => updateEntry(index,
              { ...item, placement: { mode: 'depth', depth: item.placement.mode === 'depth' ? item.placement.depth : 0,
                slot: event.target.value } })}>
              {draft.entries.filter(slotsOnly).filter(candidate => candidate.enabled && candidate.dataType === 'messages')
                .map(candidate => <option value={candidate.key} key={candidate.id}>{candidate.name} ({candidate.key})</option>)}</select></label>
            <label>Depth <input type="number" min="0" value={item.placement.depth} onChange={event => updateEntry(index,
              { ...item, placement: { mode: 'depth', slot: item.placement.mode === 'depth' ? item.placement.slot : '',
                depth: Number(event.target.value) } })} /></label>
          </>}
        </>}
      </section>)}
      <section className="preset-entry"><div className="toolbar"><h3>Preview</h3><button onClick={() => void showPreview()}>Refresh preview</button></div>
        <label>Session <select value={sessionId} onChange={event => setSessionId(event.target.value)}>
          <option value="">Sample conversation</option>{sessions.map(session => <option value={session.id} key={session.id}>{session.title}</option>)}
        </select></label>
        {draft.entries.filter(slotsOnly).filter(item => item.dataType === 'text').map(item =>
          <label key={item.id}>Sample {item.key}<textarea rows={2} placeholder="<context>"
            value={samples[item.key] ?? ''} onChange={event => setSamples({ ...samples, [item.key]: event.target.value })} /></label>)}
        {preview.map((message, index) => <div className="preview-message" key={index}><strong>{message.role}</strong><p>{message.content}</p></div>)}
        <p className="hint">Connect a preset's enabled slots to an LLM node in <Link to="/workflows">Workflows</Link>.</p>
      </section>
    </div> : <div className="empty-state"><h1>Presets</h1><p>Select or create a preset.</p></div>}</div>;
}
