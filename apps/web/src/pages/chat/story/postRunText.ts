import type { PostRunRef } from './postRuns.js';

// Every word the user reads about the workflows that run after the reply (the chat's workflows below the last one that
// replies), in one place.

/** The status row's text; `workflowName` (the view names the run) says which workflow runs now. */
export const postRunningLabel = (turnNumber: number | null, workflowName?: string): string => {
  const what = workflowName === undefined ? 'after the reply' : `${workflowName} after the reply`;
  return turnNumber === null ? `Running ${what}…` : `Running ${what}… (turn ${turnNumber})`;
};

export const POST_STOP_LABEL = 'Stop the workflows running after the reply';
export const POST_WAITING_LABEL = 'Waiting for the workflows after the reply to finish';
export const POST_DETAILS_LABEL = 'Run details';
export const POST_NO_LOG = 'No log was saved for this run.';
export const POST_STOPPED_NOTE = 'The workflows after the reply were stopped before they finished.';
export const POST_NOTHING_STORED = 'The workflows after the reply ran and stored nothing.';
export const POST_FAILURES_HEADING = 'Runs after the reply that failed';

/** What a failed run belongs to, for the panel's list: a turn can have no reply, or have lost its replies. */
export const postFailureSubject = ({ turnNumber, replies }: { turnNumber: number | null; replies: number }): string =>
  turnNumber === null ? 'A turn whose replies were deleted' : `Turn ${turnNumber}${replies === 0 ? ' (no reply)' : ''}`;

export const postFailureToast = ({ turnNumber, error, workflowName }: PostRunRef): string =>
  `${workflowName === undefined ? 'A workflow' : `Workflow ${workflowName}`} failed after the reply${turnNumber === null ? '' : ` on turn ${turnNumber}`}: ${error ?? 'unknown error'}`;

export const postFailureNote = (message?: string, workflowName?: string): string => {
  const run = `${workflowName === undefined ? 'A workflow' : `Workflow ${workflowName}`} failed after the reply`;
  return message ? `${run}: ${message}` : `${run}.`;
};

/**
 * The chip's button name: the stored lines when the turn has any, else its warnings, else (a turn of several runs) its
 * runs, else the run after the reply alone.
 */
export const chipLabel = (hasLines: boolean, hasWarnings = false, hasRuns = false): string =>
  hasLines ? 'What this turn stored' : hasWarnings ? 'Turn warnings' : hasRuns ? 'Turn runs' : 'Run details';

export const RUNS_HEADING = 'Runs:';
export const runPartLabel = (part: 'reply' | 'post'): string => (part === 'reply' ? 'reply' : 'after the reply');
export const RUN_UNKNOWN_WORKFLOW = 'Unknown workflow';
