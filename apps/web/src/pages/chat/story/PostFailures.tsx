import { ExecutionDetails } from '../ExecutionDetails.js';
import type { PostFailure } from './postRuns.js';
import { POST_DETAILS_LABEL, POST_FAILURES_HEADING, postFailureNote, postFailureSubject } from './postRunText.js';

/**
 * The chat panel's list of after-reply runs that failed or were cut short, with each run's log: the toast is gone
 * after a moment and the chip needs a reply to hang on, so this is where a failure stays visible.
 */
export function PostFailures({ failures }: { failures: readonly PostFailure[] }) {
  if (!failures.length) return null;
  return (
    <div className="story-post-failures">
      <h4>{POST_FAILURES_HEADING}</h4>
      <ul>
        {failures.map((failure, index) => (
          <li key={failure.executionId ?? index}>
            <p className="error">
              <strong>{postFailureSubject(failure)}</strong> · {postFailureNote(failure.error, failure.workflowName)}
            </p>
            {failure.executionId && <ExecutionDetails id={failure.executionId} label={POST_DETAILS_LABEL} optional />}
          </li>
        ))}
      </ul>
    </div>
  );
}
