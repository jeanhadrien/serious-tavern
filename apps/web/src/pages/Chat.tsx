import { useEffect, useState } from 'react';
import type { Workflow, Session, ExecutionLog, ChatMessage } from '@st/shared';
import { api, json, getWorkflows, type SessionSummary } from '../api.js';

function ExecutionDetails({ id, cached }: { id: string; cached?: ExecutionLog }) {
  const [execution, setExecution] = useState(cached);
  const [error, setError] = useState('');
  useEffect(() => { if (!execution) void api<ExecutionLog>(`/executions/${id}`).then(setExecution).catch(e => setError(String(e))); }, [id]);
  return <details className="execution"><summary>Execution details</summary>{error && <p className="error">{error}</p>}
    {execution && <><small>{execution.status} · {execution.id}</small>{Object.entries(execution.nodes).map(([nodeId, node]) =>
      <div className="execution-node" key={nodeId}><strong>{nodeId}</strong> · {node.status} · {node.durationMs ?? 0}ms
        {node.error && <p className="error">{node.error}</p>}
        {node.output !== undefined && <pre>{JSON.stringify(node.output, null, 2)}</pre>}</div>)}</>}</details>;
}
export function Chat() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<Session>();
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<Record<string, ExecutionLog>>({});
  const refresh = () => api<SessionSummary[]>('/sessions').then(list => setSessions(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
  useEffect(() => { void getWorkflows().then(setWorkflows).catch(e => setError(String(e))); void refresh().catch(e => setError(String(e))); }, []);
  const open = async (id: string) => { try { setSession(await api<Session>(`/sessions/${id}`)); setError(''); } catch (e) { setError(String(e)); } };
  const create = async () => {
    const initialWorkflow = workflows.find(w => w.name === 'Default Assistant') ?? workflows[0];
    if (!initialWorkflow) return;
    try { const next = await api<Session>('/sessions', json('POST', { workflowId: initialWorkflow.id })); await refresh(); setSession(next); setError(''); }
    catch (e) { setError(String(e)); }
  };
  const update = async (changes: { title?: string; workflowId?: string }) => {
    if (!session) return;
    try { const next = await api<Session>(`/sessions/${session.id}`, json('PATCH', changes)); setSession(next); await refresh(); }
    catch (e) { setError(String(e)); }
  };
  const remove = async (id: string) => {
    try { await api(`/sessions/${id}`, json('DELETE')); if (session?.id === id) setSession(undefined); await refresh(); }
    catch (e) { setError(String(e)); }
  };
  const send = async () => {
    if (!session || !content.trim() || busy) return;
    const text = content.trim(); setContent(''); setBusy(true); setError('');
    try {
      const result = await api<{ userMessage: ChatMessage; assistantMessage: ChatMessage; execution: ExecutionLog }>(
        `/sessions/${session.id}/messages`, json('POST', { content: text }));
      setSession(prev => prev?.id === session.id ? { ...prev, messages: [...prev.messages, result.userMessage, result.assistantMessage] } : prev);
      setLogs(prev => ({ ...prev, [result.execution.id]: result.execution }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      <div className="thread">{session.messages.map(m => <article className={`message ${m.role}`} key={m.id}>
        <small>{m.role}</small><p>{m.content}</p>
        {m.executionId && <ExecutionDetails id={m.executionId} cached={logs[m.executionId]} />}</article>)}
        {busy && <p className="hint">Running workflow…</p>}</div>
      {error && <p className="error">{error}</p>}
      <form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}>
        <input aria-label="Message" placeholder="Write a message…" value={content} onChange={e => setContent(e.target.value)} />
        <button className="primary" disabled={busy || !content.trim()}>Send</button></form></> :
      <div className="empty-state"><h1>Start a conversation</h1><p>Create a chat to run one of your workflows.</p>
        {error && <p className="error">{error}</p>}<button className="primary" disabled={!workflows.length} onClick={() => void create()}>New chat</button></div>}</section></div>;
}
