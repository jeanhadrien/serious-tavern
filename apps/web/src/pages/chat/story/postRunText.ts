import type { PostRunRef } from './postRuns.js';

// Every word the user reads about after-reply runs, in one place. "After-reply steps" is the user-facing term: the
// node is After Reply, but the work behind it is not always memory.

export const postRunningLabel = (turnNumber: number | null): string =>
  turnNumber === null ? 'Running after-reply steps…' : `Running after-reply steps… (turn ${turnNumber})`;

export const POST_STOP_LABEL = 'Stop after-reply steps';
export const POST_WAITING_LABEL = 'Waiting for the after-reply steps to finish';
export const POST_DETAILS_LABEL = 'After-reply run details';
export const POST_NO_LOG = 'No log was saved for this run.';
export const POST_STOPPED_NOTE = 'After-reply steps were stopped before they finished.';

export const postFailureToast = ({ turnNumber, error }: PostRunRef): string =>
  `After-reply steps failed${turnNumber === null ? '' : ` on turn ${turnNumber}`}: ${error ?? 'unknown error'}`;

export const postFailureNote = (message?: string): string =>
  message ? `After-reply steps failed: ${message}` : 'After-reply steps failed.';

/** The chip's button name: the stored lines when the turn has any, else the after-reply run alone. */
export const chipLabel = (hasLines: boolean): string =>
  hasLines ? 'What this turn stored' : 'After-reply steps details';
