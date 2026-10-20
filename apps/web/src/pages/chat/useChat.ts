import { useCallback, useEffect, useRef, useState } from 'react';
import {
  turnFailureDetailsSchema,
  type TurnFailureDetails,
  type Session,
  type ExecutionLog,
  type ApiBody,
  type ChatMessage,
  type ReplyEntry,
} from '@st/shared';
import { sessionsApi, streamMessage, streamRegenerate } from '../../api.js';
import { ApiError, notifyError } from '../../api/transport.js';
import type { TurnHandlers, TurnResult } from '../../api/turnStream.js';
import { alerts } from '../../alerts/index.js';
import { charactersStore, personasStore, sessionsStore, useList, workflowsStore } from '../../stores/index.js';
import { createDraftSaver, loadDraft, pruneDrafts, saveDraft } from './composerDraft.js';
import { withStoredMetadata, withStoredSettings, withStoredTriggers } from './openSession.js';
import { copiedList } from './panel/replyList.js';
import type { SaveOptions } from './panel/useSettingSaver.js';
import {
  applyDelta,
  lastTurnReplyIds,
  replaceLastTurnReplies,
  resultLogs,
  settleRegenerate,
  settleTurn,
} from './turnMessages.js';
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
  // A sent message the server has not started yet: it may wait behind another turn or a run after the reply.
  const [queued, setQueued] = useState(false);
  const queuedRef = useRef(false);
  const cancelledRef = useRef(false);
  const setWaiting = (value: boolean) => {
    queuedRef.current = value;
    setQueued(value);
  };
  // The workflow whose run started last (`run.start`): the "waiting" indicator names it until a reply row shows up.
  const [runningWorkflow, setRunningWorkflow] = useState<string>();
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
    // A new chat starts with the open chat's reply list (order and switches included), else the Default Assistant alone.
    const copied = copiedList(session, workflows);
    try {
      const next = await sessionsApi.create({
        ...(copied ? { triggers: { reply: copied } } : { workflowId: initialWorkflow.id }),
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
  // The reply list saves while a turn runs too (it applies from the next turn); only `triggers` and `workflowId` are
  // taken from the answer (`withStoredTriggers`). The panel's saver sends one request at a time, so answers come in order.
  // Resolves true when saved; on a failure (toasted) the panel falls back to what the server holds.
  const updateReplyList = useCallback(async (sessionId: string, reply: ReplyEntry[]): Promise<boolean> => {
    const apply = (next: Session) => setSession((current) => withStoredTriggers(current, next));
    try {
      apply(await sessionsApi.update(sessionId, { triggers: { reply } }));
      return true;
    } catch {
      await sessionsApi
        .get(sessionId, { silent: true })
        .then(apply)
        .catch(() => {});
      return false;
    }
  }, []);
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
  // run after the reply), so it is cancelled by aborting its request instead; the server then drops it unstored.
  const stop = () => {
    if (!busyRef.current || !session) return;
    if (queuedRef.current) {
      cancelledRef.current = true;
      streamControllerRef.current?.abort();
      return;
    }
    sessionsApi.stopTurn(session.id, { silent: true }).catch(() => streamControllerRef.current?.abort());
  };
  // The streaming path of a send and of a regenerate: rows are local (`streaming`) until the turn settles, errors
  // are decided here (never toasted by the stream), and a failure without saved details falls back to the server's
  // copy of the chat.
  const runStream = async (
    sessionId: string,
    stream: (handlers: TurnHandlers, signal: AbortSignal) => Promise<void>,
    kind: { optimisticUser?: ChatMessage; replaced?: readonly string[]; cancelled?: () => void },
  ) => {
    const { optimisticUser, replaced } = kind;
    const patchMessages = (change: (messages: ChatMessage[]) => ChatMessage[]) =>
      setSession((prev) => (prev?.id === sessionId ? { ...prev, messages: change(prev.messages) } : prev));
    const settle = (result: TurnResult | TurnFailureDetails) => {
      patchMessages((messages) =>
        replaced ? settleRegenerate(messages, replaced, result) : settleTurn(messages, optimisticUser?.id, result),
      );
      // Every run of the turn has a log (a result from before reply lists has the one).
      setLogs((prev) => ({ ...prev, ...Object.fromEntries(resultLogs(result).map((log) => [log.id, log])) }));
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
      await stream(
        {
          onStart: () => {
            setWaiting(false);
            // A regenerate shows only its own rows once the server runs it; until then (queued) the reply stays.
            if (replaced) patchMessages((messages) => replaceLastTurnReplies(messages, replaced));
          },
          onRun: (run) => setRunningWorkflow(run.workflowName),
          onDelta: (delta) => patchMessages((messages) => applyDelta(messages, delta)),
          onComplete: settle,
        },
        controller.signal,
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
        if (cancelledRef.current) kind.cancelled?.();
        // Whatever the server kept (the user message, partial rows) is the truth; drop local rows.
        await resync();
      }
    } finally {
      streamControllerRef.current = undefined;
      cancelledRef.current = false;
      busyRef.current = false;
      setBusy(false);
      setWaiting(false);
      setRunningWorkflow(undefined);
      refresh().catch(() => {});
    }
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
    await runStream(sessionId, (handlers, signal) => streamMessage(sessionId, text, handlers, { signal }), {
      optimisticUser,
      // A message cancelled while it waited goes back to the composer, to be edited or sent again.
      cancelled: () => {
        if (contentRef.current) return;
        show(text);
        saveDraft(sessionId, text);
      },
    });
  };
  // Runs the last turn again on the same history. The composer and its draft are not involved. The current replies
  // stay until the server starts the run; then they are hidden (the new rows stream in their place), and they come
  // back if the run leaves no reply at all (`settleRegenerate`).
  const regenerate = async () => {
    if (!session || busyRef.current || messageActions.isPending()) return;
    const replaced = lastTurnReplyIds(session.messages);
    if (!replaced.length) return;
    busyRef.current = true;
    setBusy(true);
    setWaiting(true);
    await runStream(session.id, (handlers, signal) => streamRegenerate(session.id, handlers, { signal }), {
      replaced,
    });
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
    runningWorkflow,
    logs,
    open,
    close,
    create,
    update,
    updateSettings,
    updateReplyList,
    remove,
    send,
    regenerate,
    swipe: messageActions.swipe,
    stop,
    mutating: messageActions.mutating,
    editMessage: messageActions.editMessage,
    deleteMessage: messageActions.deleteMessage,
  };
}

export type ChatState = ReturnType<typeof useChat>;
