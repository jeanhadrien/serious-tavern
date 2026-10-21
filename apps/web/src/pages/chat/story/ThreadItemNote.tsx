import { useState } from 'react';
import { ExecutionDetails } from '../ExecutionDetails.js';
import { threadNote, toolNames, type ThreadSummary } from './threadItems.js';

/**
 * What a thread item says about its exchange ("3 tool calls · 4 steps", the tool names on hover) and a way to the
 * log of the run that wrote it, where the whole exchange is. The log is only fetched once asked for: a long thread
 * must not load one log per row.
 */
export function ThreadItemNote({ thread }: { thread: ThreadSummary }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <small className="story-thread-note" title={toolNames(thread) || undefined}>
        {threadNote(thread)}
      </small>
      {thread.runId && (
        <>
          <button
            type="button"
            className="story-turn-link story-thread-log"
            aria-expanded={shown}
            onClick={() => setShown((open) => !open)}
          >
            {shown ? 'Hide run log' : 'Run log'}
          </button>
          {shown && <ExecutionDetails id={thread.runId} label="Run details" optional defaultOpen />}
        </>
      )}
    </>
  );
}
