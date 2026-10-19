import { useEffect, useRef } from 'react';
import type { SessionStateView } from '@st/shared';
import { alerts } from '../../../alerts/index.js';
import { nextAlerts, type AlertMemory } from './postRuns.js';
import { postFailureToast } from './postRunText.js';

/** Toasts each failed run after the reply of the open chat once (see `nextAlerts`). Renders nothing. */
export function usePostRunAlerts(sessionId: string | undefined, view: SessionStateView | undefined): void {
  const memory = useRef<AlertMemory | undefined>(undefined);
  useEffect(() => {
    if (!sessionId || !view) return;
    const next = nextAlerts(memory.current, sessionId, view);
    memory.current = next.memory;
    for (const failure of next.failures) alerts.error(postFailureToast(failure));
  }, [sessionId, view]);
}
