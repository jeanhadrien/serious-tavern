import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionStateView } from '@st/shared';
import { sessionsApi } from '../../../api.js';
import { subscribeToChanges } from '../../../api/events.js';
import { startStoryLoader } from './storyStateLoader.js';

/** What the chat panel's Story state section shows. The object keeps its identity until the view changes. */
export interface StoryPanelData {
  view?: SessionStateView;
  /** The last load failed (the previous view, if any, is still shown). */
  failed: boolean;
}

interface Slot {
  sessionId: string;
  view?: SessionStateView;
  failed: boolean;
}

/**
 * The open chat's story state: ONE fetch shared by the chat panel, the reply chips and the delete check. It is
 * loaded when the chat opens and again after the changes that can alter it (see `startStoryLoader`), and once
 * more when a running turn or message change finishes (`idle` turns true), in case the event was missed. It is
 * never fetched per streamed token. The view is the server's answer; the web never folds anything itself,
 * except the delete check's what-if.
 */
export function useStoryState(
  sessionId: string | undefined,
  idle: boolean,
): { view?: SessionStateView; panel: StoryPanelData } {
  const [slot, setSlot] = useState<Slot>();
  const loader = useRef<{ reload(): void } | undefined>(undefined);
  useEffect(() => {
    if (!sessionId) return;
    const started = startStoryLoader(
      sessionId,
      { fetch: (id) => sessionsApi.state(id, { silent: true }), subscribe: subscribeToChanges },
      (result) =>
        setSlot((previous) => {
          const before = previous?.sessionId === sessionId ? previous : undefined;
          return 'view' in result
            ? { sessionId, view: result.view, failed: false }
            : { sessionId, view: before?.view, failed: true };
        }),
    );
    loader.current = started;
    return () => {
      started.stop();
      loader.current = undefined;
    };
  }, [sessionId]);
  const wasIdle = useRef(idle);
  useEffect(() => {
    if (idle && !wasIdle.current) loader.current?.reload();
    wasIdle.current = idle;
  }, [idle]);

  // A slot of another chat is never shown.
  const current = slot?.sessionId === sessionId ? slot : undefined;
  const view = current?.view;
  const failed = current?.failed ?? false;
  const panel = useMemo(() => ({ view, failed }), [view, failed]);
  return { view, panel };
}
