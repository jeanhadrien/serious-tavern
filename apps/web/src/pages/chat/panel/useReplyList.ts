import { useCallback, useRef, useState } from 'react';
import type { ReplyEntry } from '@st/shared';
import { addEntry, moveEntry, removeEntry, toggleEntry } from './replyList.js';
import { createReplySaver } from './replySaver.js';

/** Saves a whole reply list; true when the server stored it (a failure is already reported). */
export type SaveReplyList = (sessionId: string, list: ReplyEntry[]) => Promise<boolean>;

/**
 * The "On reply" list of one chat: the saved list, or the newest one still being saved (`createReplySaver`). Every
 * control changes it and saves at once; the handlers keep their identity, so rows that did not change are not rendered
 * again.
 */
export function useReplyList(sessionId: string, stored: readonly ReplyEntry[], onSave: SaveReplyList) {
  const [pending, setPending] = useState<ReplyEntry[]>();
  const list = pending ?? stored;
  const latest = useRef({ sessionId, onSave, list });
  latest.current = { sessionId, onSave, list };
  const saver = useRef<ReturnType<typeof createReplySaver>>(undefined);
  saver.current ??= createReplySaver((next) => latest.current.onSave(latest.current.sessionId, next), setPending);
  // Built from the newest list, shown or not yet rendered, so two changes in one tick both count.
  const change = (make: (current: readonly ReplyEntry[]) => ReplyEntry[]) => {
    const next = make(latest.current.list);
    latest.current.list = next;
    saver.current?.change(next);
  };
  return {
    list,
    add: useCallback((workflowId: string) => change((current) => addEntry(current, workflowId)), []),
    remove: useCallback((workflowId: string) => change((current) => removeEntry(current, workflowId)), []),
    toggle: useCallback((workflowId: string) => change((current) => toggleEntry(current, workflowId)), []),
    move: useCallback((from: number, to: number) => change((current) => moveEntry(current, from, to)), []),
  };
}
