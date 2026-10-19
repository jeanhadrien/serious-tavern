import { useEffect, useMemo, useState } from 'react';
import type { ReplyEntry, ReplyPlan } from '@st/shared';
import { sessionsApi } from '../../../api.js';
import { subscribeToChanges } from '../../../api/events.js';
import { startReplyPlanLoader } from './replyPlanLoader.js';

/**
 * What each enabled workflow of the chat's saved reply list waits for (`GET /api/sessions/:id/reply-plan`), for the hints
 * under the rows. Loaded when the list is opened, again whenever the saved list changes or something it depends on does
 * (see `startReplyPlanLoader`), and never per streamed token. Undefined until loaded, and while the list has changed and
 * the plan for the new one has not arrived: a plan of another list would put the hints on the wrong rows.
 */
export function useReplyPlan(sessionId: string, saved: readonly ReplyEntry[]): ReplyPlan | undefined {
  const key = useMemo(() => `${sessionId}\n${JSON.stringify(saved)}`, [sessionId, saved]);
  const [loaded, setLoaded] = useState<{ key: string; plan: ReplyPlan }>();
  useEffect(() => {
    const loader = startReplyPlanLoader(
      sessionId,
      { fetch: (id) => sessionsApi.replyPlan(id, { silent: true }), subscribe: subscribeToChanges },
      (plan) => setLoaded(plan ? { key, plan } : undefined),
    );
    return () => loader.stop();
  }, [sessionId, key]);
  return loaded?.key === key ? loaded.plan : undefined;
}
