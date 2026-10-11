import { useEffect, useRef, useState } from 'react';
import {
  turnFailureDetailsSchema,
  type TurnFailureDetails,
  type Workflow,
  type Session,
  type ExecutionLog,
  type SessionSummary,
  type ApiBody,
  type Character,
  type Persona,
  type ChatMessage,
} from '@st/shared';
import { sessionsApi, workflowsApi, charactersApi, personasApi, streamMessage } from '../../api.js';
import { ApiError, notifyError } from '../../api/transport.js';
import type { TurnResult } from '../../api/turnStream.js';
import { alerts } from '../../alerts/index.js';
import { compareRecent } from '../recentOrder.js';
import { applyDelta, settleTurn } from './turnMessages.js';
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
  const streamControllerRef = useRef<AbortController | undefined>(undefined);
  const [logs, setLogs] = useState<Record<string, ExecutionLog>>({});
  const refresh = () =>
    sessionsApi.list().then((list) => setSessions(list.sort((a, b) => compareRecent(a, b, (item) => item.title))));
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
  useEffect(() => {
    return () => {
      streamControllerRef.current?.abort();
    };
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
  // Asks the server to stop; the open stream then ends with the partial rows, which `send` settles.
  // Aborting the connection is only the fallback, for when the stop request itself cannot get through.
  const stop = () => {
    if (!busyRef.current || !session) return;
    sessionsApi.stopTurn(session.id, { silent: true }).catch(() => streamControllerRef.current?.abort());
  };
  const send = async () => {
    if (!session || !content.trim() || busyRef.current || messageActions.isPending()) return;
    busyRef.current = true;
    const sessionId = session.id;
    const text = content.trim();
    setContent('');
    setBusy(true);

    const optimisticUser: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    const patchMessages = (change: (messages: ChatMessage[]) => ChatMessage[]) =>
      setSession((prev) => (prev?.id === sessionId ? { ...prev, messages: change(prev.messages) } : prev));
    const settle = (result: TurnResult | TurnFailureDetails) => {
      patchMessages((messages) => settleTurn(messages, optimisticUser.id, result));
      setLogs((prev) => ({ ...prev, [result.execution.id]: result.execution }));
    };
    const resync = () =>
      sessionsApi
        .get(sessionId, { silent: true })
        .then((current) => setSession((prev) => (prev?.id === current.id ? current : prev)))
        .catch(() => {});
    patchMessages((messages) => [...messages, optimisticUser]);

    const controller = new AbortController();
    streamControllerRef.current = controller;
    try {
      await streamMessage(
        sessionId,
        text,
        {
          onDelta: (nodeId, textDelta, reasoningDelta) =>
            patchMessages((messages) => applyDelta(messages, nodeId, textDelta, reasoningDelta)),
          onComplete: settle,
        },
        { signal: controller.signal },
      );
    } catch (error) {
      const failure = error instanceof ApiError ? turnFailureDetailsSchema.safeParse(error.details) : undefined;
      if (failure?.success) {
        // The server saved the user message and any partial replies before ending the turn.
        settle(failure.data);
        if (error instanceof ApiError && error.code === 'TURN_STOPPED') alerts.info('Generation stopped');
        else if (error instanceof ApiError) notifyError(error);
      } else {
        if (error instanceof ApiError) notifyError(error);
        else if (!(error instanceof Error && error.name === 'AbortError')) alerts.error(String(error));
        // Whatever the server kept (the user message, partial rows) is the truth; drop local rows.
        await resync();
      }
    } finally {
      streamControllerRef.current = undefined;
      busyRef.current = false;
      setBusy(false);
      refresh().catch(() => {});
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
    stop,
    refreshAll,
    mutating: messageActions.mutating,
    editMessage: messageActions.editMessage,
    deleteMessage: messageActions.deleteMessage,
  };
}
