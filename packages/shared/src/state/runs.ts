import {
  appendLinkWarnings,
  effectivePostRun,
  POST_ERROR_LIMIT,
  POST_INTERRUPTED_MESSAGE,
  type PostRun,
} from './post-run.js';
import {
  type SessionState,
  type StateWrite,
  type TurnEntry,
  type TurnRun,
  turnRunSchema,
  withUpdatedTurnEntry,
} from './writes.js';

/** What a run of a turn leaves in the turn's entry when it settles. */
export type RunSettlement = {
  /**
   * The run's record. A run the entry already lists (an after-reply run announced as `running`) is replaced in place; a
   * run it does not list (a reply run after the first) is appended, so `runs` stays in the order the runs happened.
   */
  run: TurnRun;
  /** The run's resolved writes, also of a failed or stopped run (the nodes that completed): appended after everything earlier. */
  writes: readonly StateWrite[];
  /** Assistant messages the run saved (partial rows included); added to the entry's count. */
  replies?: number;
  /** Warnings of linked writes the run lost at commit time (see `LINK_WARNING_LIMITS`). */
  linkWarnings?: readonly string[];
  /**
   * Further runs of the turn that will follow, announced as `running` in the same write (the after-reply runs, known
   * when the last reply run settles), appended after the run's record.
   */
  announce?: readonly TurnRun[];
  /**
   * A regenerate: a turn that ends with no reply is not a turn of its own (it would count, being completed) and is
   * stored as not completed.
   */
  needsReply?: boolean;
};

const isRun = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

/**
 * `state` with a run of the turn `turnExecutionId` settled into its entry, the way `withPostRun` settles an after-reply
 * run (the one place runs are recorded after the entry exists; the first reply run creates the entry itself):
 * `writes` appended AFTER everything earlier, so a later write to a key wins and deleting the turn's replies undoes all
 * of them; `replies` added; `linkWarnings` appended; the run's record appended or replaced; and, when the run is a reply
 * run, `completed` recomputed: true only while every reply run of the entry ran to the end (and, for a regenerate, the
 * turn replied). Keeps unknown things as `withUpdatedTurnEntry` does; no matching entry returns the state unchanged. A
 * run's `error` is kept only for the status `error` and cut to `POST_ERROR_LIMIT`. Never changes its input.
 */
export function withRunSettled(state: unknown, turnExecutionId: string, settlement: RunSettlement): SessionState {
  const { run, writes, replies = 0, linkWarnings, announce = [], needsReply } = settlement;
  return withUpdatedTurnEntry(state, turnExecutionId, (raw) => {
    const { error: _stale, ...stored } = run;
    const record = {
      ...stored,
      ...(run.status === 'error' && run.error ? { error: run.error.slice(0, POST_ERROR_LIMIT) } : {}),
    };
    const earlier = Array.isArray(raw.runs) ? raw.runs : [];
    const listed = earlier.some((item) => isRun(item) && item.executionId === run.executionId);
    const runs = [
      ...(listed
        ? earlier.map((item) => (isRun(item) && item.executionId === run.executionId ? record : item))
        : [...earlier, record]),
      ...announce,
    ];
    const total = (typeof raw.replies === 'number' ? raw.replies : 0) + replies;
    const replyRuns = runs.flatMap((item) => {
      const parsed = turnRunSchema.safeParse(item);
      return parsed.success && parsed.data.part === 'reply' ? [parsed.data] : [];
    });
    const completed = replyRuns.every((item) => item.status === 'completed') && !(needsReply && total === 0);
    return {
      ...raw,
      runs,
      replies: total,
      writes: [...(Array.isArray(raw.writes) ? raw.writes : []), ...writes],
      ...(run.part === 'reply' ? { completed } : {}),
      ...(linkWarnings?.length && { linkWarnings: appendLinkWarnings(raw, linkWarnings) }),
    };
  });
}

/**
 * The entry's runs as they should be shown: a run stored as `running` that the server no longer holds (`isLive` false:
 * it restarted) reads as an error. Undefined for a legacy entry (no `runs`). Pure; stored data is never rewritten.
 */
export function effectiveRuns(
  entry: Pick<TurnEntry, 'runs'>,
  isLive: (executionId: string) => boolean,
): TurnRun[] | undefined {
  return entry.runs?.map((run) => {
    if (run.status !== 'running' || isLive(run.executionId)) return run;
    return { ...run, status: 'error', error: POST_INTERRUPTED_MESSAGE };
  });
}

/**
 * The turn's after-reply status in the one shape older readers know (`postStatus`, `postExecutionId`, `postError`),
 * derived from the post runs of a new entry: any `running` reads as running; else the first `error` with its text; else
 * `stopped` if any; else `completed`; the id is the first post run's. A legacy entry says it itself
 * (`effectivePostRun`, `live` being whether the server holds its run). Undefined when the turn left no after-reply run.
 */
export function postOfEntry(
  entry: Pick<TurnEntry, 'runs' | 'postExecutionId' | 'postStatus' | 'postError'>,
  isLive: (executionId: string) => boolean,
): PostRun | undefined {
  const runs = effectiveRuns(entry, isLive);
  if (!runs) return effectivePostRun(entry, entry.postExecutionId !== undefined && isLive(entry.postExecutionId));
  const post = runs.filter((run) => run.part === 'post');
  const first = post[0];
  if (!first) return undefined;
  const failed = post.find((run) => run.status === 'error');
  const status = post.some((run) => run.status === 'running')
    ? 'running'
    : failed
      ? 'error'
      : post.some((run) => run.status === 'stopped')
        ? 'stopped'
        : 'completed';
  return {
    status,
    executionId: first.executionId,
    ...(status === 'error' && failed?.error ? { error: failed.error } : {}),
  };
}
