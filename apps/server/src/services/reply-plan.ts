import {
  describeResource,
  predecessors,
  replyWorkflows,
  waitReason,
  type ApiResponse,
  type StateDefinition,
} from '@st/shared';
import type { AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { prepareList, runAccess, sessionCards } from './reply-list.js';
import { listDefinitions } from './story-state.js';

/** Why one run waits for an earlier one, in plain words: what it reads and who writes it. */
function reasonFor(
  { read }: NonNullable<ReturnType<typeof waitReason>>,
  writer: string,
  definitions: readonly StateDefinition[],
): string {
  return read.kind === 'messages'
    ? `reads the chat history ${writer} writes`
    : `reads ${describeResource(read, definitions)}, which ${writer} writes`;
}

/**
 * What each enabled workflow of the chat's reply list waits for, from the same access sets a turn schedules by
 * (`prepareList`, `runAccess`, `predecessors`), so the list can say beforehand which workflows run together. A workflow
 * that is gone or invalid cannot run (a turn would refuse to start): it is listed with a reason and takes no part in the
 * waiting of the others.
 */
export async function replyPlan(context: AppContext, sessionId: string): Promise<ApiResponse<'getReplyPlan'>> {
  const session = await requireEntity(context.sessions, sessionId, 'Session');
  const definitions = await listDefinitions(context.stateDefinitions);
  const listed = await prepareList(
    context,
    replyWorkflows(session).filter((entry) => entry.enabled),
    definitions,
  );
  const cards = await sessionCards(context, session, listed.find((item) => item.prepared)?.prepared?.resources);
  const runnable = listed.flatMap((item) =>
    item.prepared && item.workflow
      ? [{ id: item.entry.workflowId, name: item.workflow.name, access: runAccess(item.prepared, cards, definitions) }]
      : [],
  );
  const waits = predecessors(runnable.map((run) => run.access));
  return {
    entries: listed.map(({ entry, workflow, prepared }) => {
      const workflowId = entry.workflowId;
      if (!workflow) return { workflowId, waitsFor: [], reason: 'This workflow no longer exists.' };
      if (!prepared) return { workflowId, waitsFor: [], reason: 'This workflow is invalid, so it cannot run yet.' };
      const index = runnable.findIndex((run) => run.id === workflowId);
      const earlier = waits[index]!.map((position) => runnable[position]!);
      const reasons = earlier.flatMap((run) => {
        const why = waitReason(run.access, runnable[index]!.access);
        return why ? [reasonFor(why, run.name, definitions)] : [];
      });
      return {
        workflowId,
        waitsFor: earlier.map((run) => run.id),
        ...(reasons.length ? { reason: reasons.join('; ') } : {}),
      };
    }),
  };
}
