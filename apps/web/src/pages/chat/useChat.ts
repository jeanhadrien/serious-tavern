import { useCallback, useEffect, useRef, useState } from 'react';
import {
  turnFailureDetailsSchema,
  type TurnFailureDetails,
  type Session,
  type ExecutionLog,
  type ApiBody,
  type ChatMessage,
} from '@st/shared';
import { sessionsApi, streamMessage } from '../../api.js';
import { ApiError, notifyError } from '../../api/transport.js';
import type { TurnResult } from '../../api/turnStream.js';
import { alerts } from '../../alerts/index.js';
import { charactersStore, personasStore, sessionsStore, useList, workflowsStore } from '../../stores/index.js';
import { createDraftSaver, loadDraft, pruneDrafts, saveDraft } from './composerDraft.js';
import { withStoredMetadata, withStoredSettings } from './openSession.js';
import type { SaveOptions } from './panel/useSettingSaver.js';
import { applyDelta, settleTurn } from './turnMessages.js';
import { useMessageActions } from './useMessageActions.js';

export function useChat() {
  const workflows = useList(workflowsStore);
  const characters = useList(charactersStore);
  const personas = useList(personasStore);
  const sessions = useList(sessionsStore);
  const [session, setSession] = useState<Session>();
  const [content, setContentState] = useState('');
  // The composer text per chat: saved to localStorage debounced and on leaving a chat, never per streamed token
  // (typing is the only writer; a turn's tokens never touch it).
  const contentRef = useRef('');
  const sessionIdRef = useRef<string | undefined>(undefined);
  const [draftSaver] = useState(createDraftSaver);
  const show = (text: string) => {
    contentRef.current = text;
    setContentState(text);
  };
  const setContent = useCallback(
    (text: string) => {
      contentRef.current = text;
      setContentState(text);
      if (sessionIdRef.current) draftSaver.schedule(sessionIdRef.current, text);
    },
    [draftSaver],
  );
  // Opens a chat (or none): the previous draft is written first, the new chat's draft is shown.
  const enter = (next: Session | undefined) => {
    draftSaver.flush();
    sessionIdRef.current = next?.id;
    setSession(next);
    show(next ? loadDraft(next.id) : '');
  };
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // A sent message the server has not started yet: it may wait behind another turn or an after-reply run.
  const [queued, setQueued] = useState(false);
  const queuedRef = useRef(false);
  const cancelledRef = useRef(false);
  const setWaiting = (value: boolean) => {
    queuedRef.current = value;
    setQueued(value);
  };
  const opening = useRef(0);
  const streamControllerRef = useRef<AbortController | undefined>(undefined);
  const [logs, setLogs] = useState<Record<string, ExecutionLog>>({});
  const refresh = () => sessionsStore.refresh().then(() => {});
  const messageActions = useMessageActions(session, setSession, refresh, () => busyRef.current);
  useEffect(() => {
    return () => {
      streamControllerRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    const flush = () => draftSaver.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [draftSaver]);
  // Drafts of deleted chats do not stay behind.
  useEffect(() => {
    sessionsStore
      .refresh()
      .then((list) =>
        pruneDrafts([...list.map((item) => item.id), ...(sessionIdRef.current ? [sessionIdRef.current] : [])]),
      )
      .catch(() => {});
  }, []);
  const open = async (id: string) => {
    if (busyRef.current || messageActions.isPending()) return;
    const request = ++opening.current;
    try {
      const next = await sessionsApi.get(id);
      if (opening.current === request) enter(next);
    } catch {
      /* API errors are toasted. */
    }
  };
  // Leaves the open chat (e.g. browser Back to a URL without one).
  const close = () => {
    if (busyRef.current || messageActions.isPending()) return;
    ++opening.current;
    enter(undefined);
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
      if (request === opening.current) enter(next);
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
      setSession((current) => withStoredMetadata(current, next));
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };
  // Chat settings save while a turn streams too (the turn already took its values); only `settings` is taken
  // from the answer (`withStoredSettings`). The panel's saver sends one request at a time, so answers come
  // in order and each holds every earlier write.
  const updateSettings = useCallback(
    async (sessionId: string, patch: Record<string, unknown>, options?: SaveOptions) => {
      const apply = (next: Session) => setSession((current) => withStoredSettings(current, next));
      try {
        apply(await sessionsApi.update(sessionId, { settings: patch }, options));
      } catch {
        // The error is toasted; show what the server holds.
        await sessionsApi
          .get(sessionId, { silent: true })
          .then(apply)
          .catch(() => {});
      }
    },
    [],
  );
  const remove = async (id: string) => {
    if (busyRef.current || messageActions.isPending()) return;
    ++opening.current;
    try {
      await sessionsApi.delete(id);
      if (sessionIdRef.current === id) {
        draftSaver.cancel();
        enter(undefined);
      }
      saveDraft(id, '');
      setSession((current) => (current?.id === id ? undefined : current));
      alerts.info('Chat deleted');
      await refresh();
    } catch {
      /* API errors are toasted. */
    }
  };
  // Asks the server to stop; the open stream then ends with the partial rows, which `send` settles.
  // Aborting the connection is only the fallback, for when the stop request itself cannot get through. A message
  // that has not started yet is not what the server's Stop would stop (it ends the job that runs, e.g. an
  // after-reply run), so it is cancelled by aborting its request instead; the server then drops it unstored.
  const stop = () => {
    if (!busyRef.current || !session) return;
    if (queuedRef.current) {
      cancelledRef.current = true;
      streamControllerRef.current?.abort();
      return;
    }
    sessionsApi.stopTurn(session.id, { silent: true }).catch(() => streamControllerRef.current?.abort());
  };
  const send = async () => {
    if (!session || busyRef.current || messageActions.isPending()) return;
    busyRef.current = true;
    const sessionId = session.id;
    const text = content.trim();
    // Sending clears the stored draft at once; only a message cancelled while queued is put back.
    draftSaver.cancel();
    saveDraft(sessionId, '');
    show('');
    setBusy(true);
    setWaiting(true);

    // An empty send adds no user message; the turn runs on the history as it is.
    const optimisticUser: ChatMessage | undefined = text
      ? { id: crypto.randomUUID(), role: 'user', content: text, createdAt: new Date().toISOString() }
      : undefined;
    const patchMessages = (change: (messages: ChatMessage[]) => ChatMessage[]) =>
      setSession((prev) => (prev?.id === sessionId ? { ...prev, messages: change(prev.messages) } : prev));
    const settle = (result: TurnResult | TurnFailureDetails) => {
      patchMessages((messages) => settleTurn(messages, optimisticUser?.id, result));
      setLogs((prev) => ({ ...prev, [result.execution.id]: result.execution }));
    };
    const resync = () =>
      sessionsApi
        .get(sessionId, { silent: true })
        .then((current) => setSession((prev) => (prev?.id === current.id ? current : prev)))
        .catch(() => {});
    if (optimisticUser) patchMessages((messages) => [...messages, optimisticUser]);

    const controller = new AbortController();
    streamControllerRef.current = controller;
    try {
      await streamMessage(
        sessionId,
        text,
        {
          onStart: () => setWaiting(false),
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
        // A message cancelled while it waited goes back to the composer, to be edited or sent again.
        if (cancelledRef.current && !contentRef.current) {
          show(text);
          saveDraft(sessionId, text);
        }
        // Whatever the server kept (the user message, partial rows) is the truth; drop local rows.
        await resync();
      }
    } finally {
      streamControllerRef.current = undefined;
      cancelledRef.current = false;
      busyRef.current = false;
      setBusy(false);
      setWaiting(false);
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
    queued,
    logs,
    open,
    close,
    create,
    update,
    updateSettings,
    remove,
    send,
    stop,
    mutating: messageActions.mutating,
    editMessage: messageActions.editMessage,
    deleteMessage: messageActions.deleteMessage,
  };
}

export type ChatState = ReturnType<typeof useChat>;
