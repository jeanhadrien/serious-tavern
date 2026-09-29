import { useEffect, useState } from 'react';
import type { Workflow, Session, ExecutionLog, SessionSummary, ApiBody, Character, Persona } from '@st/shared';
import { sessionsApi, workflowsApi, charactersApi, personasApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';

export function useChat() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<Session>();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<Record<string, ExecutionLog>>({});
  const refresh = () =>
    sessionsApi.list().then((list) => setSessions(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
  useEffect(() => {
    void workflowsApi
      .list()
      .then(setWorkflows)
      .catch(() => {});
    void charactersApi
      .list()
      .then(setCharacters)
      .catch(() => {});
    void personasApi
      .list()
      .then(setPersonas)
      .catch(() => {});
    void refresh().catch(() => {});
  }, []);
  const open = async (id: string) => {
    try {
      setSession(await sessionsApi.get(id));
    } catch {
      /* API errors are toasted. */
    }
  };
  const create = async () => {
    const initialWorkflow = workflows.find((w) => w.name === 'Default Assistant') ?? workflows[0];
    if (!initialWorkflow) return;
    try {
      const next = await sessionsApi.create({
        workflowId: initialWorkflow.id,
        personaId: session?.personaId ?? personas[0]?.id,
      });
      setSession(next);
      alerts.info('Chat created');
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };
  const update = async (changes: ApiBody<'updateSession'>) => {
    if (!session) return;
    try {
      const next = await sessionsApi.update(session.id, changes);
      setSession(next);
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };
  const remove = async (id: string) => {
    try {
      await sessionsApi.delete(id);
      if (session?.id === id) setSession(undefined);
      alerts.info('Chat deleted');
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };
  const send = async () => {
    if (!session || !content.trim() || busy) return;
    const text = content.trim();
    setContent('');
    setBusy(true);
    try {
      const result = await sessionsApi.sendMessage(session.id, { content: text });
      setSession((prev) =>
        prev?.id === session.id
          ? { ...prev, messages: [...prev.messages, result.userMessage, result.assistantMessage] }
          : prev,
      );
      setLogs((prev) => ({ ...prev, [result.execution.id]: result.execution }));
      await refresh();
    } catch {
      await open(session.id);
    } finally {
      setBusy(false);
    }
  };
  return {
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
  };
}
