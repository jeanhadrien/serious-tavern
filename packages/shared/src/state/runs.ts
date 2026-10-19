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
   * run it does not list is placed by its `position` (appended when it has none), so `runs` stays in list order.
   */
  run: TurnRun;
  /** The run's resolved writes, also of a failed or stopped run (the nodes that completed): placed by the run's position. */
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

/** The writes tagged with the run that made them (see `stateWriteSchema`). */
export const taggedWrites = (writes: readonly StateWrite[], runId: string): StateWrite[] =>
  writes.map((write) => ({ ...write, runId }));

const positionOf = (raw: unknown): number | undefined =>
  isRun(raw) && typeof raw.position === 'number' ? raw.position : undefined;

/** `items` with `item` inserted before the first one that `follows`, else at the end. */
function inserted<T>(items: readonly T[], item: T, follows: (existing: T) => boolean): T[] {
  const at = items.findIndex(follows);
  return at < 0 ? [...items, item] : [...items.slice(0, at), item, ...items.slice(at)];
}

/**
 * `state` with a run of the turn `turnExecutionId` settled into its entry (the one place runs are recorded after the
 * entry exists; the turn's first settle creates the entry itself): the run's `writes`, tagged with the run, placed by
 * its list position; `replies` added; `linkWarnings` appended; the run's record placed or replaced; and, when the run is
 * a reply run, `completed` recomputed: true only while every reply run of the entry ran to the end (and, for a
 * regenerate, the turn replied). Keeps unknown things as `withUpdatedTurnEntry` does; no matching entry returns the state
 * unchanged. A run's `error` is kept only for the status `error` and cut to `POST_ERROR_LIMIT`. Never changes its input.
 *
 * Runs of a turn may finish in any order, but the entry always reads as if they had settled top to bottom: a run's
 * record goes after the records of the runs listed above it and before those listed below it, and so do its writes among
 * the others' (a write whose run is not recorded, or a run without a position, counts as listed above everything). A run
 * without a `position` is appended, which is the order of runs that settle one after another.
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
    const placed = listed
      ? earlier.map((item) => (isRun(item) && item.executionId === run.executionId ? record : item))
      : run.position === undefined
        ? [...earlier, record]
        : inserted(earlier, record, (item) => (positionOf(item) ?? -1) > run.position!);
    const runs = [...placed, ...announce];
    const total = (typeof raw.replies === 'number' ? raw.replies : 0) + replies;
    const replyRuns = runs.flatMap((item) => {
      const parsed = turnRunSchema.safeParse(item);
      return parsed.success && parsed.data.part === 'reply' ? [parsed.data] : [];
    });
    const completed = replyRuns.every((item) => item.status === 'completed') && !(needsReply && total === 0);
    const position =
      run.position ?? positionOf(placed.find((item) => isRun(item) && item.executionId === run.executionId));
    const positions = new Map(
      runs.flatMap((item) =>
        isRun(item) && typeof item.executionId === 'string' ? [[item.executionId, positionOf(item)]] : [],
      ),
    );
    const storedWrites = Array.isArray(raw.writes) ? raw.writes : [];
    const tagged = taggedWrites(writes, run.executionId);
    const settled =
      position === undefined
        ? [...storedWrites, ...tagged]
        : [
            ...storedWrites.filter((write) => !listsAfter(write, positions, position)),
            ...tagged,
            ...storedWrites.filter((write) => listsAfter(write, positions, position)),
          ];
    return {
      ...raw,
      runs,
      replies: total,
      writes: settled,
      ...(run.part === 'reply' ? { completed } : {}),
      ...(linkWarnings?.length && { linkWarnings: appendLinkWarnings(raw, linkWarnings) }),
    };
  });
}

// Whether a stored write was made by a run listed below the one at `position`.
function listsAfter(write: unknown, positions: ReadonlyMap<string, number | undefined>, position: number): boolean {
  const runId = isRun(write) && typeof write.runId === 'string' ? write.runId : undefined;
  return (runId === undefined ? -1 : (positions.get(runId) ?? -1)) > position;
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
