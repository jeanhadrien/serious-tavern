import { useEffect, useRef, useState } from 'react';
import type { TextStats } from '@st/shared';
import { sessionsApi } from '../../api.js';
import { subscribeToChanges } from '../../api/events.js';
import { startSessionLoader } from './sessionLoader.js';
import { becameIdle } from './story/storySlot.js';

/** The statistics of the open chat's assistant replies, by message id. */
export type MessageStatsMap = Readonly<Record<string, TextStats>>;

interface Loaded {
  sessionId: string;
  /** `undefined` while the server has the app setting off. */
  stats?: MessageStatsMap;
}

/**
 * The open chat's text statistics, or `undefined` while there are none to show (not loaded yet, a failed load, or the
 * `showMessageStats` setting off: the web never reads the setting, the server answers `enabled: false`). One fetch
 * per chat, again after this chat's `sessions.changed` and `appSettings.changed` (see `startSessionLoader`) and when a
 * running turn or message change finishes. Never fetched per streamed token. The map keeps its identity until a load
 * delivers a new one.
 */
export function useMessageStats(sessionId: string | undefined, idle: boolean): MessageStatsMap | undefined {
  const [loaded, setLoaded] = useState<Loaded>();
  const loader = useRef<{ reload(): void } | undefined>(undefined);
  useEffect(() => {
    if (!sessionId) return;
    const started = startSessionLoader(
      sessionId,
      {
        fetch: (id) => sessionsApi.stats(id, { silent: true }),
        subscribe: subscribeToChanges,
        alsoOn: { 'appSettings.changed': 0 },
      },
      // A failed load keeps what the chat showed; the next change tries again.
      (result) => {
        if ('failed' in result) return;
        const { enabled, messages } = result.value;
        setLoaded({ sessionId, stats: enabled ? messages : undefined });
      },
    );
    loader.current = started;
    return () => {
      started.stop();
      loader.current = undefined;
    };
  }, [sessionId]);
  const wasIdle = useRef(idle);
  useEffect(() => {
    if (becameIdle(wasIdle.current, idle)) loader.current?.reload();
    wasIdle.current = idle;
  }, [idle]);
  // Statistics loaded for another chat are never shown.
  return loaded && loaded.sessionId === sessionId ? loaded.stats : undefined;
}
