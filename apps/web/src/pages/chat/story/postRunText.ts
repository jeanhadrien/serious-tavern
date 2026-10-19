import type { PostRunRef } from './postRuns.js';

// Every word the user reads about after-reply runs, in one place. "After-reply steps" is the user-facing term: the
// node is After Reply, but the work behind it is not always memory.

/** The status row's text; `workflowName` (a chat with a list of workflows) says which one's steps run now. */
export const postRunningLabel = (turnNumber: number | null, workflowName?: string): string => {
  const of = workflowName === undefined ? '' : ` of ${workflowName}`;
  return turnNumber === null
    ? `Running after-reply steps${of}…`
    : `Running after-reply steps${of}… (turn ${turnNumber})`;
};

export const POST_STOP_LABEL = 'Stop after-reply steps';
export const POST_WAITING_LABEL = 'Waiting for the after-reply steps to finish';
export const POST_DETAILS_LABEL = 'After-reply run details';
export const POST_NO_LOG = 'No log was saved for this run.';
export const POST_STOPPED_NOTE = 'After-reply steps were stopped before they finished.';
export const POST_NOTHING_STORED = 'The after-reply steps ran and stored nothing.';
export const POST_FAILURES_HEADING = 'After-reply steps that failed';

/** What a failed run belongs to, for the panel's list: a turn can have no reply, or have lost its replies. */
export const postFailureSubject = ({ turnNumber, replies }: { turnNumber: number | null; replies: number }): string =>
  turnNumber === null ? 'A turn whose replies were deleted' : `Turn ${turnNumber}${replies === 0 ? ' (no reply)' : ''}`;

export const postFailureToast = ({ turnNumber, error, workflowName }: PostRunRef): string =>
  `After-reply steps${workflowName === undefined ? '' : ` of ${workflowName}`} failed${turnNumber === null ? '' : ` on turn ${turnNumber}`}: ${error ?? 'unknown error'}`;

export const postFailureNote = (message?: string, workflowName?: string): string => {
  const steps = `After-reply steps${workflowName === undefined ? '' : ` of ${workflowName}`}`;
  return message ? `${steps} failed: ${message}` : `${steps} failed.`;
};

/**
 * The chip's button name: the stored lines when the turn has any, else its warnings, else (a turn of several runs) its
 * runs, else the after-reply run alone.
 */
export const chipLabel = (hasLines: boolean, hasWarnings = false, hasRuns = false): string =>
  hasLines
    ? 'What this turn stored'
    : hasWarnings
      ? 'Turn warnings'
      : hasRuns
        ? 'Turn runs'
        : 'After-reply steps details';

export const RUNS_HEADING = 'Runs:';
export const runPartLabel = (part: 'reply' | 'post'): string => (part === 'reply' ? 'reply' : 'after reply');
export const RUN_UNKNOWN_WORKFLOW = 'Unknown workflow';
