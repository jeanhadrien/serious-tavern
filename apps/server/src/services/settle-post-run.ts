import { withPostRun, type PostRunResult, type Session, type StateDefinition } from '@st/shared';
import { commitLinks } from './links.js';
import { historyMessages } from './settle-turn.js';

export type PostSettlement = {
  turnExecutionId: string;
  /** Names the keys of the writes in the warnings of the link check. */
  definitions?: readonly StateDefinition[];
} & PostRunResult;

/**
 * The after-reply run's result into the session: its status and error on the turn's entry, and its state writes
 * appended to that entry's, so deleting the turn's replies undoes them too. A write that links messages is judged
 * against the chat as it is now (`commitLinks`), so one whose messages changed while the run went on is dropped.
 * Called inside the caller's `sessions.silent.update` mutation, under the session lock; it leaves `updatedAt` alone
 * (only a message advances it). The one place a post run commits into the session. Returns the warnings of dropped
 * writes, for the run's execution log; the turn's entry keeps them too, so the chat can show them.
 */
export function settlePostRun(
  current: Session,
  { turnExecutionId, definitions = [], ...result }: PostSettlement,
): string[] {
  const committed = commitLinks(historyMessages(current.messages), result.writes, definitions);
  current.state = withPostRun(current.state, turnExecutionId, {
    ...result,
    writes: committed.writes,
    linkWarnings: committed.warnings,
  });
  return committed.warnings;
}
