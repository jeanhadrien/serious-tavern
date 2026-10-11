import { useEffect, useRef, useState } from 'react';
import type { Workflow, Session, ExecutionLog, SessionSummary, ApiBody, Character, Persona } from '@st/shared';
import { sendMessageResultSchema } from '@st/shared';
import { sessionsApi, workflowsApi, charactersApi, personasApi } from '../../api.js';
import { ApiError } from '../../api/transport.js';
import { alerts } from '../../alerts/index.js';
import { useMessageActions } from './useMessageActions.js';

export function useChat() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<Session>();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const opening = useRef(0);
  const [logs, setLogs] = useState<Record<string, ExecutionLog>>({});
  const refresh = () =>
    sessionsApi.list().then((list) => setSessions(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
  const messageActions = useMessageActions(session, setSession, refresh, () => busyRef.current);
  const refreshAll = () => {
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
  };
  useEffect(() => {
    refreshAll();
  }, []);
  const open = async (id: string) => {
    if (busyRef.current || messageActions.isPending()) return;
    const request = ++opening.current;
    try {
      const next = await sessionsApi.get(id);
      if (opening.current === request) {
        setSession(next);
        setContent('');
      }
    } catch {
      /* API errors are toasted. */
    }
  };
  const create = async () => {
    if (busyRef.current || messageActions.isPending()) return;
    const request = ++opening.current;
    const initialWorkflow = workflows.find((w) => w.name === 'Default Assistant') ?? workflows[0];
    if (!initialWorkflow) return;
    try {
      const next = await sessionsApi.create({
        workflowId: initialWorkflow.id,
        personaId: session?.personaId ?? personas[0]?.id,
      });
      if (request === opening.current) {
        setSession(next);
        setContent('');
      }
      alerts.info('Chat created');
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };
  const update = async (changes: ApiBody<'updateSession'>) => {
    if (!session || busyRef.current || messageActions.isPending()) return;
    try {
      const next = await sessionsApi.update(session.id, changes);
      setSession((current) => (current?.id === next.id ? { ...next, messages: current.messages } : current));
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };
  const remove = async (id: string) => {
    if (busyRef.current || messageActions.isPending()) return;
    ++opening.current;
    try {
      await sessionsApi.delete(id);
      setSession((current) => (current?.id === id ? undefined : current));
      alerts.info('Chat deleted');
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };
  const send = async () => {
    if (!session || !content.trim() || busyRef.current || messageActions.isPending()) return;
    ++opening.current;
    busyRef.current = true;
    const text = content.trim();
    setContent('');
    setBusy(true);
    try {
      const result = await sessionsApi.sendMessage(session.id, { content: text });
      setSession((prev) =>
        prev?.id === session.id
          ? { ...prev, messages: [...prev.messages, result.userMessage, ...result.assistantMessages] }
          : prev,
      );
      setLogs((prev) => ({ ...prev, [result.execution.id]: result.execution }));
      await refresh().catch(() => {});
    } catch (error) {
      const details = sendMessageResultSchema.safeParse(error instanceof ApiError ? error.details : undefined);
      if (details.success) {
        const result = details.data;
        setSession((prev) =>
          prev?.id === session.id
            ? { ...prev, messages: [...prev.messages, result.userMessage, ...result.assistantMessages] }
            : prev,
        );
        setLogs((prev) => ({ ...prev, [result.execution.id]: result.execution }));
        await refresh().catch(() => {});
      } else {
        await sessionsApi
          .get(session.id)
          .then((current) => {
            setSession((previous) => (previous?.id === current.id ? current : previous));
          })
          .catch(() => {});
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return {
    workflows,
    characters,
    personas,
    sessions,
    session,
    content,
    setContent,
    busy,
    logs,
    open,
    create,
    update,
    remove,
    send,
    refreshAll,
    mutating: messageActions.mutating,
    editMessage: messageActions.editMessage,
    deleteMessage: messageActions.deleteMessage,
  };
}
