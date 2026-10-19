import type { ApiResponse, ExecutionLog } from '@st/shared';
import { ExecutionFailure } from '@st/engine';
import type { AppContext } from '../context.js';
import { HttpError } from '../errors.js';
import { failureMessage } from './failure.js';
import { runPostTurns } from './post-turn.js';
import { runReplySection } from './reply-section.js';
import { startTurn, type TurnRequest } from './turn-start.js';
import type { TurnFrame } from './turn-stream.js';
import type { RunningTurn } from './turns.js';

export type TurnOptions = {
  // Receives the turn's events. Passing it streams passthrough Chat Outputs live.
  emit?: (frame: TurnFrame) => void;
  // Aborts the turn when the client disconnects, also one still waiting in the queue (it then stores nothing).
  signal?: AbortSignal;
  // Only a turn that has not started is cancelled by `signal`: one that runs finishes (the plain endpoint).
  keepRunning?: boolean;
};

export function sendMessage(
  context: AppContext,
  sessionId: string,
  content: string,
  signal?: AbortSignal,
): Promise<ApiResponse<'sendMessage'>> {
  return runTurn(context, sessionId, content, { signal, keepRunning: true });
}

export function regenerate(
  context: AppContext,
  sessionId: string,
  signal?: AbortSignal,
): Promise<ApiResponse<'regenerate'>> {
  return runRegenerate(context, sessionId, { signal, keepRunning: true });
}

// One turn per session, in order. The session's storage lock is only held for short writes, never across the engine run.
export function runTurn(
  context: AppContext,
  sessionId: string,
  content: string,
  options: TurnOptions = {},
): Promise<ApiResponse<'sendMessage'>> {
  return runRequest(context, sessionId, { content }, options);
}

// The last turn again, in the same queue as messages: Stop and a client leaving work as for a message.
export function runRegenerate(
  context: AppContext,
  sessionId: string,
  options: TurnOptions = {},
): Promise<ApiResponse<'regenerate'>> {
  return runRequest(context, sessionId, { regenerate: true }, options);
}

function runRequest(
  context: AppContext,
  sessionId: string,
  request: TurnRequest,
  options: TurnOptions,
): Promise<ApiResponse<'sendMessage'>> {
  return context.turns.run(sessionId, async (turn) => {
    if (options.signal?.aborted) throw new HttpError(409, 'TURN_STOPPED', 'The turn was cancelled before it started');
    const disconnected = () => turn.stop('disconnect');
    if (!options.keepRunning) options.signal?.addEventListener('abort', disconnected, { once: true });
    try {
      return await executeTurn(context, sessionId, request, turn, options);
    } finally {
      options.signal?.removeEventListener('abort', disconnected);
    }
  });
}

async function executeTurn(
  context: AppContext,
  sessionId: string,
  request: TurnRequest,
  turn: RunningTurn,
  options: TurnOptions,
): Promise<ApiResponse<'sendMessage'>> {
  const started = await startTurn(context, sessionId, request);
  options.emit?.({ type: 'turn.start', executionId: started.runs[0]!.runId });
  // The reply section: each enabled workflow's reply part, one after another, each settled in its own write.
  const { results, userMessage, stopped, posts } = await runReplySection(
    context,
    sessionId,
    turn,
    started,
    options.emit,
  );
  // One announcement for the whole section, whatever happened in it (success, failure or stop).
  context.changes.publish({ type: 'sessions.changed', id: sessionId });
  // The reply is complete for the client. The after-reply runs follow in this turn's queue slot, after the caller has its
  // result; their ids are on the RunningTurn already, so a state read can tell they are live.
  if (posts.length) turn.after = (run) => runPostTurns(context, sessionId, posts, run);
  const assistantMessages = results.flatMap((result) => result.replies);
  const executions = results.flatMap((result) => (result.execution ? [result.execution] : []));
  const failed = results.find((result) => result.failure !== undefined);
  if (!failed && !stopped) return { userMessage, assistantMessages, execution: executions[0]!, executions };
  const details = (execution: ExecutionLog) => ({ execution, executions, userMessage, assistantMessages });
  // A stop ends the turn as stopped, with the log of the run it ended (or of the last one run, when it fell between two
  // runs); otherwise the first failure does, after the runs below it ran.
  if (stopped) {
    const last = results.at(-1)!;
    if (!last.execution) throw last.failure;
    throw new HttpError(409, 'TURN_STOPPED', 'The turn was stopped before it finished', {
      ...details(last.execution),
      aborted: turn.stoppedBy,
    });
  }
  const { failure, planned } = failed!;
  if (!(failure instanceof ExecutionFailure)) throw failure;
  const message = failureMessage(failure);
  // Said with the workflow's name only when several ran, so a chat of one workflow reads exactly as it always did.
  throw new HttpError(
    500,
    'WORKFLOW_EXECUTION_FAILED',
    started.runs.length > 1 ? `Workflow "${planned.workflow.name}" failed: ${message}` : message,
    details(failure.execution),
  );
}
