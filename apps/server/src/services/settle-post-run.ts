import { withPostRun, type PostRunResult, type Session, type SummaryWrite } from '@st/shared';
import { commitSummaries } from './summaries.js';

export type PostSettlement = {
  turnExecutionId: string;
  /** The after-reply run's own execution id (the summaries it wrote are stamped with it). */
  executionId: string;
  /** The summaries its Save Summary nodes asked to store; absent when it wrote none. */
  summaryWrites?: SummaryWrite[];
} & PostRunResult;

/**
 * The after-reply run's result into the session: its status and error on the turn's entry, its state writes appended
 * to that entry's (so deleting the turn's replies undoes them too), and its summaries committed against the chat as it
 * is now. Summaries are not turn state: they land in `session.summaries` whether or not the turn's entry still counts.
 * Called inside the caller's `sessions.silent.update` mutation, under the session lock; it leaves `updatedAt` alone
 * (only a message advances it). The one place a post run commits into the session. Returns the warnings of summary
 * writes that were dropped, for the run's execution log.
 */
export function settlePostRun(
  current: Session,
  { turnExecutionId, executionId, summaryWrites = [], ...result }: PostSettlement,
): string[] {
  current.state = withPostRun(current.state, turnExecutionId, result);
  return commitSummaries(current, summaryWrites, executionId);
}
