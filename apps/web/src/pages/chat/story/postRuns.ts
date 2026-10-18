import type { PostStatus, SessionStateView } from '@st/shared';

type TurnView = SessionStateView['turns'][number];

/** A turn's after-reply run as the state view reports it. */
export type PostRunRef = { executionId?: string; turnNumber: number | null; status: PostStatus; error?: string };

export const postRunOf = (turn: TurnView): PostRunRef | undefined =>
  turn.postStatus
    ? {
        status: turn.postStatus,
        turnNumber: turn.turnNumber,
        ...(turn.postExecutionId !== undefined && { executionId: turn.postExecutionId }),
        ...(turn.postError !== undefined && { error: turn.postError }),
      }
    : undefined;

/** The newest after-reply run that is still running, if any: what the status row near the composer shows. */
export function runningPostRun(view: SessionStateView | undefined): PostRunRef | undefined {
  for (const turn of [...(view?.turns ?? [])].reverse()) {
    const run = postRunOf(turn);
    if (run?.status === 'running') return run;
  }
  return undefined;
}

/** The newest failed or interrupted runs the chat panel lists. */
const POST_FAILURES_SHOWN = 3;

/** A failed (or interrupted) after-reply run, with what the panel needs to say which turn it belongs to. */
export type PostFailure = PostRunRef & { replies: number };

/**
 * The newest runs that failed or were cut short, newest first: they stay visible after a toast is gone, for a turn
 * without a reply (no chip to hang on) and for failures that happened while the chat was not open. A stopped run is
 * the user's own doing and is not listed.
 */
export function postFailures(view: SessionStateView | undefined): PostFailure[] {
  const failures: PostFailure[] = [];
  for (const turn of [...(view?.turns ?? [])].reverse()) {
    const run = postRunOf(turn);
    if (run?.status === 'error') failures.push({ ...run, replies: turn.replies });
    if (failures.length === POST_FAILURES_SHOWN) break;
  }
  return failures;
}

/** Which failures were already seen in the open chat, so each one toasts once. */
export type AlertMemory = { sessionId: string; seen: ReadonlySet<string> };

/**
 * The failed after-reply runs of `view` that have not been announced. The first view of a chat is the baseline:
 * its failures (older ones, or one cut short by a restart) are on the chips and never toast. After that every
 * failed run the memory has not seen toasts once, whether or not it was ever seen running (a fast failure can be
 * missed between two views). A stopped run is the user's own doing and never toasts.
 */
export function nextAlerts(
  memory: AlertMemory | undefined,
  sessionId: string,
  view: SessionStateView,
): { memory: AlertMemory; failures: PostRunRef[] } {
  const baseline = memory?.sessionId !== sessionId;
  const seen = new Set(baseline ? [] : memory.seen);
  const failures: PostRunRef[] = [];
  for (const turn of view.turns) {
    const run = postRunOf(turn);
    if (run?.status !== 'error') continue;
    const key = run.executionId ?? turn.executionId;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!baseline) failures.push(run);
  }
  return { memory: { sessionId, seen }, failures };
}
