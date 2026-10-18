import { withPostRun, type PostRunResult, type Session } from '@st/shared';

export type PostSettlement = { turnExecutionId: string } & PostRunResult;

/**
 * The after-reply run's result into the session: its status and error on the turn's entry, and its state writes
 * appended to that entry's, so deleting the turn's replies undoes them too. Called inside the caller's
 * `sessions.silent.update` mutation, under the session lock; it leaves `updatedAt` alone (only a message advances
 * it). The one place a post run commits into the session: later work (summaries) joins it here.
 */
export function settlePostRun(current: Session, { turnExecutionId, ...result }: PostSettlement): void {
  current.state = withPostRun(current.state, turnExecutionId, result);
}
