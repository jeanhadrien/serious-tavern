import { useEffect, useState } from 'react';
import type { Workflow, Session, ExecutionLog, ChatMessage } from '@st/shared';
import { api, json, getWorkflows, getCharacters, getPersonas, type SessionSummary } from '../api.js';
import type { Character, Persona } from '@st/shared';
import { alerts } from '../alerts/index.js';

function ExecutionDetails({ id, cached }: { id: string; cached?: ExecutionLog }) {
  const [execution, setExecution] = useState(cached);
  useEffect(() => { if (!execution) void api<ExecutionLog>(`/executions/${id}`).then(setExecution).catch(() => {}); }, [id]);
  return <details className="execution"><summary>Execution details</summary>
    {execution && <><small>{execution.status} · {execution.id}</small>{Object.entries(execution.nodes).map(([nodeId, node]) =>
      <div className="execution-node" key={nodeId}><strong>{nodeId}</strong> · {node.status} · {node.durationMs ?? 0}ms
        {node.error && <p className="error">{node.error}</p>}
        {node.request !== undefined && <details><summary>LLM request (no secrets)</summary>
          <pre>{JSON.stringify(node.request, null, 2)}</pre></details>}
        {node.output !== undefined && <pre>{JSON.stringify(node.output, null, 2)}</pre>}</div>)}</>}</details>;
}
export function Chat() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<Session>();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<Record<string, ExecutionLog>>({});
  const refresh = () => api<SessionSummary[]>('/sessions').then(list => setSessions(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
  useEffect(() => {
    void getWorkflows().then(setWorkflows).catch(() => {});
    void getCharacters().then(setCharacters).catch(() => {});
    void getPersonas().then(setPersonas).catch(() => {});
    void refresh().catch(() => {});
  }, []);
  const open = async (id: string) => { try { setSession(await api<Session>(`/sessions/${id}`)); } catch { /* API errors are toasted. */ } };
  const create = async () => {
    const initialWorkflow = workflows.find(w => w.name === 'Default Assistant') ?? workflows[0];
    if (!initialWorkflow) return;
    try { const next = await api<Session>('/sessions', json('POST', { workflowId: initialWorkflow.id,
      personaId: session?.personaId ?? personas[0]?.id }));
      setSession(next); alerts.info('Chat created'); await refresh(); }
    catch { /* API errors are toasted. */ }
  };
  const update = async (changes: { title?: string; workflowId?: string; characterId?: string | null; personaId?: string | null }) => {
    if (!session) return;
    try { const next = await api<Session>(`/sessions/${session.id}`, json('PATCH', changes)); setSession(next); await refresh(); }
    catch { /* API errors are toasted. */ }
  };
  const remove = async (id: string) => {
    try { await api(`/sessions/${id}`, json('DELETE')); if (session?.id === id) setSession(undefined);
      alerts.info('Chat deleted'); await refresh(); }
    catch { /* API errors are toasted. */ }
  };
  const send = async () => {
    if (!session || !content.trim() || busy) return;
    const text = content.trim(); setContent(''); setBusy(true);
    try {
      const result = await api<{ userMessage: ChatMessage; assistantMessage: ChatMessage; execution: ExecutionLog }>(
        `/sessions/${session.id}/messages`, json('POST', { content: text }));
      setSession(prev => prev?.id === session.id ? { ...prev, messages: [...prev.messages, result.userMessage, result.assistantMessage] } : prev);
      setLogs(prev => ({ ...prev, [result.execution.id]: result.execution }));
      await refresh();
    } catch {
      await open(session.id);
    } finally { setBusy(false); }
  };
  return <div className="chat-layout"><aside className="sidebar"><div className="toolbar"><h2>Chats</h2>
    <button className="primary" onClick={() => void create()} disabled={!workflows.length}>+ New</button></div>
    {sessions.map(s => <div className={`session-row ${s.id === session?.id ? 'selected' : ''}`} key={s.id}>
      <button className="session-link" onClick={() => void open(s.id)}>{s.title}</button>
      <button title="Delete chat" onClick={() => void remove(s.id)}>×</button></div>)}</aside>
    <section className="chat-main">{session ? <><header className="chat-header">
      <input aria-label="Chat title" value={session.title} onChange={e => setSession({ ...session, title: e.target.value })}
        onBlur={() => void update({ title: session.title || 'New chat' })} />
      <select aria-label="Workflow" value={session.workflowId} onChange={e => void update({ workflowId: e.target.value })}>
        {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></header>
      <div className="session-context-selectors">
        <label className="context-selector">Character{session.characterId && characters.some(item => item.id === session.characterId) &&
          (typeof characters.find(item => item.id === session.characterId)?.avatar === 'string' ?
            <img src={`/api/characters/${session.characterId}/avatar`} /> : null)}
          <select aria-label="Active character" value={session.characterId ?? ''}
            onChange={e => void update({ characterId: e.target.value || null })}>
            <option value="">None</option>{characters.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
        <label className="context-selector">Persona{session.personaId && personas.some(item => item.id === session.personaId) &&
          (typeof personas.find(item => item.id === session.personaId)?.avatar === 'string' ?
            <img src={`/api/personas/${session.personaId}/avatar`} /> : null)}
          <select aria-label="Active persona" value={session.personaId ?? ''}
            onChange={e => void update({ personaId: e.target.value || null })}>
            <option value="">None</option>{personas.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
      </div>
      <div className="thread">{session.messages.map(m => <article className={`message ${m.role}`} key={m.id}>
        <small>{m.role}</small><p>{m.content}</p>
        {m.executionId && <ExecutionDetails id={m.executionId} cached={logs[m.executionId]} />}</article>)}
        {busy && <p className="hint">Running workflow…</p>}</div>
      <form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}>
        <input aria-label="Message" placeholder="Write a message…" value={content} onChange={e => setContent(e.target.value)} />
        <button className="primary" disabled={busy || !content.trim()}>Send</button></form></> :
      <div className="empty-state"><h1>Start a conversation</h1><p>Create a chat to run one of your workflows.</p>
        <button className="primary" disabled={!workflows.length} onClick={() => void create()}>New chat</button></div>}</section></div>;
}
