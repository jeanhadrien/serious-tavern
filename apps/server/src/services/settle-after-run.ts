import { POST_ERROR_LIMIT, withRunSettled, type PostRunResult, type Session, type StateDefinition } from '@st/shared';
import { commitLinks } from './links.js';
import { historyMessages } from './settle-turn.js';

export type AfterSettlement = {
  turnExecutionId: string;
  /** The run of the after section being settled: it is listed in the turn's entry as `running` already. */
  run: { executionId: string; workflowId: string };
  /** Names the keys of the writes in the warnings of the link check. */
  definitions?: readonly StateDefinition[];
} & PostRunResult;

/**
 * A run of the after section's result into the session: its status and error on its record in the turn's entry (`runs`), and its
 * state writes appended to that entry's after everything earlier, so deleting the turn's replies undoes them too. A write
 * that links messages is judged against the chat as it is now (`commitLinks`), so one whose messages changed while the run
 * went on is dropped. Called inside the caller's `sessions.silent.update` mutation, under the session lock; it leaves
 * `updatedAt` alone (only a message advances it). The one place a run of the after section commits into the session. Returns the warnings
 * of dropped writes, for the run's execution log; the turn's entry keeps them too, so the chat can show them.
 */
export function settleAfterRun(
  current: Session,
  { turnExecutionId, run, definitions = [], ...result }: AfterSettlement,
): string[] {
  const committed = commitLinks(historyMessages(current.messages), result.writes, definitions);
  current.state = withRunSettled(current.state, turnExecutionId, {
    run: {
      executionId: run.executionId,
      workflowId: run.workflowId,
      part: 'post',
      status: result.status,
      ...(result.status === 'error' && result.error ? { error: result.error.slice(0, POST_ERROR_LIMIT) } : {}),
    },
    writes: committed.writes,
    linkWarnings: committed.warnings,
  });
  return committed.warnings;
}
