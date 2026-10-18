import { type PostStatus, type SessionState, type StateWrite, type TurnEntry, withUpdatedTurnEntry } from './writes.js';

/** A post-turn run's error text is cut to this many characters in the entry (the full text is in its execution log). */
export const POST_ERROR_LIMIT = 500;
export const POST_INTERRUPTED_MESSAGE = 'The run was interrupted by a server restart.';

/** What an entry says about its post-turn run. */
export type PostRun = { status: PostStatus; executionId?: string; error?: string };

/**
 * The entry's post-turn run as it should be shown: undefined when the turn left none. A run stored as `running`
 * that the server no longer holds (`live` false: it restarted) reads as an error. Pure; stored data is never rewritten.
 */
export function effectivePostRun(
  entry: Pick<TurnEntry, 'postExecutionId' | 'postStatus' | 'postError'>,
  live: boolean,
): PostRun | undefined {
  const { postStatus: status, postExecutionId, postError } = entry;
  if (!status) return undefined;
  const executionId = postExecutionId === undefined ? {} : { executionId: postExecutionId };
  if (status === 'running' && !live) return { status: 'error', ...executionId, error: POST_INTERRUPTED_MESSAGE };
  return { status, ...executionId, ...(status === 'error' && postError ? { error: postError } : {}) };
}

export type PostRunResult = {
  status: Exclude<PostStatus, 'running'>;
  /** Cut to `POST_ERROR_LIMIT`; only kept when the status is `error`. */
  error?: string;
  /** The post run's resolved writes, also of a failed or stopped run (the nodes that completed). */
  writes: StateWrite[];
};

/**
 * `state` with the post run's result recorded on the entry whose `executionId` is given: `postStatus` (and
 * `postError` for an error) set and `writes` appended AFTER the turn's own, so a later write to a key wins and
 * deleting the turn's replies undoes both. `postExecutionId` is never changed. Keeps unknown things as
 * `withUpdatedTurnEntry` does; no matching entry returns the state unchanged. Never changes its input.
 */
export function withPostRun(state: unknown, executionId: string, result: PostRunResult): SessionState {
  return withUpdatedTurnEntry(state, executionId, (raw) => {
    const { postError: _stale, ...rest } = raw;
    const stored = Array.isArray(raw.writes) ? raw.writes : [];
    return {
      ...rest,
      postStatus: result.status,
      ...(result.status === 'error' && result.error ? { postError: result.error.slice(0, POST_ERROR_LIMIT) } : {}),
      writes: [...stored, ...result.writes],
    };
  });
}
