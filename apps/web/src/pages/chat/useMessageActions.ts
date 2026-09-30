import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ChatMessage, Session } from '@st/shared';
import { sessionsApi } from '../../api.js';

export function useMessageActions(
  session: Session | undefined,
  setSession: Dispatch<SetStateAction<Session | undefined>>,
  refresh: () => Promise<void>,
  workflowBusy: () => boolean,
) {
  const pending = useRef(false);
  const [mutating, setMutating] = useState(false);
  const mutate = async (messageId: string, content?: string): Promise<boolean> => {
    if (!session || pending.current || workflowBusy()) return false;
    pending.current = true;
    setMutating(true);
    try {
      let message: ChatMessage | undefined;
      if (content === undefined) await sessionsApi.deleteMessage(session.id, messageId);
      else message = await sessionsApi.updateMessage(session.id, messageId, { content });
      setSession((current) =>
        current?.id === session.id
          ? {
              ...current,
              messages: message
                ? current.messages.map((item) => (item.id === messageId ? message : item))
                : current.messages.filter((item) => item.id !== messageId),
            }
          : current,
      );
      // A list refresh failure must not keep an already-saved edit open.
      await refresh().catch(() => {});
      return true;
    } catch {
      return false;
    } finally {
      pending.current = false;
      setMutating(false);
    }
  };
  return {
    mutating,
    isPending: () => pending.current,
    editMessage: (id: string, content: string) => mutate(id, content),
    deleteMessage: (id: string) => mutate(id),
  };
}
