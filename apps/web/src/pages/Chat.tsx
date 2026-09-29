import { charactersApi, personasApi } from '../api.js';
import { useChat } from './chat/useChat.js';
import { ExecutionDetails } from './chat/ExecutionDetails.js';
export function Chat() {
  const {
    workflows,
    characters,
    personas,
    sessions,
    session,
    setSession,
    content,
    setContent,
    busy,
    logs,
    open,
    create,
    update,
    remove,
    send,
  } = useChat();
  return (
    <div className="chat-layout">
      <aside className="sidebar">
        <div className="toolbar">
          <h2>Chats</h2>
          <button className="primary" onClick={() => void create()} disabled={!workflows.length}>
            + New
          </button>
        </div>
        {sessions.map((s) => (
          <div className={`session-row ${s.id === session?.id ? 'selected' : ''}`} key={s.id}>
            <button className="session-link" onClick={() => void open(s.id)}>
              {s.title}
            </button>
            <button title="Delete chat" onClick={() => void remove(s.id)}>
              ×
            </button>
          </div>
        ))}
      </aside>
      <section className="chat-main">
        {session ? (
          <>
            <header className="chat-header">
              <input
                aria-label="Chat title"
                value={session.title}
                onChange={(e) => setSession({ ...session, title: e.target.value })}
                onBlur={() => void update({ title: session.title || 'New chat' })}
              />
              <select
                aria-label="Workflow"
                value={session.workflowId}
                onChange={(e) => void update({ workflowId: e.target.value })}
              >
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </header>
            <div className="session-context-selectors">
              <label className="context-selector">
                Character
                {session.characterId &&
                  characters.some((item) => item.id === session.characterId) &&
                  (typeof characters.find((item) => item.id === session.characterId)?.avatar === 'string' ? (
                    <img src={charactersApi.avatarUrl(session.characterId)} />
                  ) : null)}
                <select
                  aria-label="Active character"
                  value={session.characterId ?? ''}
                  onChange={(e) => void update({ characterId: e.target.value || null })}
                >
                  <option value="">None</option>
                  {characters.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="context-selector">
                Persona
                {session.personaId &&
                  personas.some((item) => item.id === session.personaId) &&
                  (typeof personas.find((item) => item.id === session.personaId)?.avatar === 'string' ? (
                    <img src={personasApi.avatarUrl(session.personaId)} />
                  ) : null)}
                <select
                  aria-label="Active persona"
                  value={session.personaId ?? ''}
                  onChange={(e) => void update({ personaId: e.target.value || null })}
                >
                  <option value="">None</option>
                  {personas.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="thread">
              {session.messages.map((m) => (
                <article className={`message ${m.role}`} key={m.id}>
                  <small>{m.role}</small>
                  <p>{m.content}</p>
                  {m.executionId && <ExecutionDetails id={m.executionId} cached={logs[m.executionId]} />}
                </article>
              ))}
              {busy && <p className="hint">Running workflow…</p>}
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input
                aria-label="Message"
                placeholder="Write a message…"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <button className="primary" disabled={busy || !content.trim()}>
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="empty-state">
            <h1>Start a conversation</h1>
            <p>Create a chat to run one of your workflows.</p>
            <button className="primary" disabled={!workflows.length} onClick={() => void create()}>
              New chat
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
