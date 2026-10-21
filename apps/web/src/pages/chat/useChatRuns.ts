import { useEffect, useRef } from 'react';
import { latestRunsByWorkflow, type Session } from '@st/shared';
import { chatRuns } from '../../stores/chatRuns.js';

/**
 * Publishes the open chat's latest run of each workflow for the workflow editor. It follows the stored story state
 * (which gains an entry when a turn settles) and `busy`, never the streamed text, so the token path stays free of it.
 * A reply deleted afterwards leaves its turn's run listed until the state next changes: the log still exists.
 */
export function useChatRuns(session: Session | undefined, busy: boolean) {
  const latest = useRef(session);
  latest.current = session;
  const id = session?.id;
  const state = session?.state;
  useEffect(() => {
    const current = latest.current;
    chatRuns.publish(
      new Map(
        current && !busy
          ? [...latestRunsByWorkflow(current)].map(([workflow, run]) => [workflow, run.executionId])
          : [],
      ),
    );
  }, [id, state, busy]);
}
