import {
  type RunStatus,
  type SessionState,
  type StateWrite,
  type TurnEntry,
  type TurnRun,
  turnRunSchema,
  withUpdatedTurnEntry,
} from './writes.js';

/** A run's error text is cut to this many characters in the entry (the full text is in its execution log). */
export const POST_ERROR_LIMIT = 500;
export const POST_INTERRUPTED_MESSAGE = 'The run was interrupted by a server restart.';

/** The entry keeps at most this many dropped-link warnings, each cut to this many characters. */
export const LINK_WARNING_LIMITS = { count: 5, length: 300 };

/** How a run of the after section ended: its status, error, writes and link warnings, as settled into the entry. */
export type PostRunResult = {
  status: Exclude<RunStatus, 'running'>;
  /** Cut to `POST_ERROR_LIMIT`; only kept when the status is `error`. */
  error?: string;
  /** The run's resolved writes, also of a failed or stopped run (the nodes that completed). */
  writes: StateWrite[];
  /** Warnings of linked writes this run lost at commit time; appended to the entry's (see `LINK_WARNING_LIMITS`). */
  linkWarnings?: string[];
};

/** What the turn's after section stands at, derived from its runs (see `postOfEntry`). */
export type PostRun = { status: RunStatus; executionId?: string; error?: string };

/** `raw.linkWarnings` with `warnings` appended, cut like the entry keeps them (see `LINK_WARNING_LIMITS`). */
function appendLinkWarnings(raw: Record<string, unknown>, warnings: readonly string[]): unknown[] {
  return [
    ...(Array.isArray(raw.linkWarnings) ? raw.linkWarnings : []),
    ...warnings.map((text) => text.slice(0, LINK_WARNING_LIMITS.length)),
  ].slice(-LINK_WARNING_LIMITS.count);
}

/** What a run of a turn leaves in the turn's entry when it settles. */
export type RunSettlement = {
  /**
   * The run's record. A run the entry already lists (a run of the after section announced as `running`) is replaced in place; a
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
   * Further runs of the turn that will follow, announced as `running` in the same write (the runs of the after section, known
   * when the last reply-section run settles), appended after the run's record.
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
 * `state` with a run of the turn `turnExecutionId` settled into its entry, (the one place runs are
 * recorded after the entry exists; the turn's first settle creates the entry itself):
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
 * it restarted) reads as an error. Undefined for an entry without `runs`. Pure; stored data is never rewritten.
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
 * What the turn's after section stands at, derived from its post runs: any `running` reads as running; else the first
 * `error` with its text; else `stopped` if any; else `completed`; the id is the first post run's. Undefined when the turn
 * has no run of the after section (or an entry without `runs`). The restart rule applies per run (`effectiveRuns`).
 */
export function postOfEntry(
  entry: Pick<TurnEntry, 'runs'>,
  isLive: (executionId: string) => boolean,
): PostRun | undefined {
  const post = effectiveRuns(entry, isLive)?.filter((run) => run.part === 'post') ?? [];
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
