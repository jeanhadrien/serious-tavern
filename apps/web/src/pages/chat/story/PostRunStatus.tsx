import { memo } from 'react';
import { Loader2, Square } from 'lucide-react';
import { sessionsApi } from '../../../api.js';
import { IconButton } from '../../../components/IconButton.js';
import { POST_STOP_LABEL, postRunningLabel } from './postRunText.js';
import type { PostRunRef } from './postRuns.js';
import './postRun.css';

// Stop is the chat's one stop: it ends whichever job runs, here the after-reply run. A message waiting behind the run is
// cancelled by the composer instead. Whatever the answer, the state is read again: the row is only as true as the last
// view, which a server that was killed and restarted may have outdated without any event reaching this page.
const stop = (sessionId: string, onStopped: () => void) =>
  void sessionsApi
    .stopTurn(sessionId, { silent: true })
    .catch(() => {})
    .finally(onStopped);

/**
 * A quiet row between the thread and the composer while an after-reply run works: the reply is already complete, so
 * the composer stays usable. It is `memo` and gets the run by reference, so streamed tokens of the next turn do not
 * re-render it.
 */
export const PostRunStatus = memo(function PostRunStatus({
  sessionId,
  run,
  onStopped,
}: {
  sessionId: string;
  run?: PostRunRef;
  /** Called once the stop request has been answered (or failed): reload the story state. */
  onStopped: () => void;
}) {
  if (!run) return null;
  return (
    <div className="post-run-status" role="status" aria-live="polite">
      <span className="spinning" aria-hidden="true">
        <Loader2 size={16} />
      </span>
      <span className="post-run-label">{postRunningLabel(run.turnNumber)}</span>
      <IconButton icon={Square} label={POST_STOP_LABEL} onClick={() => stop(sessionId, onStopped)} />
    </div>
  );
});
