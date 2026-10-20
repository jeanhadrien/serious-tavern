import type { RunStatus, SessionStateView } from '@st/shared';

type TurnView = SessionStateView['turns'][number];

/**
 * A turn's status of the workflows running after the reply, as the state view reports it: the run that decides it
 * (`workflowName`, and the log of that very run in `executionId`).
 */
export type PostRunRef = {
  executionId: string;
  turnNumber: number | null;
  status: RunStatus;
  error?: string;
  workflowName?: string;
};

/**
 * The run after the reply that decides a turn's status, by the rule the view's derived `postStatus` uses (any running
 * reads as running, else the first error, else a stopped one, else completed), but pointing at that run itself: the
 * derived `postExecutionId` is always the first post run's, which is not the one that failed.
 */
export function postRunOf(turn: TurnView): PostRunRef | undefined {
  const post = turn.runs?.filter((run) => run.part === 'post') ?? [];
  const decisive =
    post.find((run) => run.status === 'running') ??
    post.find((run) => run.status === 'error') ??
    post.find((run) => run.status === 'stopped') ??
    post[0];
  if (!decisive) return undefined;
  return {
    status: decisive.status,
    turnNumber: turn.turnNumber,
    executionId: decisive.executionId,
    ...(decisive.status === 'error' && decisive.error !== undefined && { error: decisive.error }),
    ...(decisive.workflowName !== undefined && { workflowName: decisive.workflowName }),
  };
}

/** The newest run after the reply that is still running, if any: what the status row near the composer shows. */
export function runningPostRun(view: SessionStateView | undefined): PostRunRef | undefined {
  for (const turn of [...(view?.turns ?? [])].reverse()) {
    const run = postRunOf(turn);
    if (run?.status === 'running') return run;
  }
  return undefined;
}

/** The newest failed or interrupted runs the chat panel lists. */
const POST_FAILURES_SHOWN = 3;

/** A failed (or interrupted) run after the reply, with what the panel needs to say which turn it belongs to. */
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
 * The failed runs after the reply of `view` that have not been announced. The first view of a chat is the baseline:
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
    if (seen.has(run.executionId)) continue;
    seen.add(run.executionId);
    if (!baseline) failures.push(run);
  }
  return { memory: { sessionId, seen }, failures };
}
