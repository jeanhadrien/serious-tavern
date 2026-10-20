import type { ChatMessage, ExecutionLog, StateSnapshot, StateWrite } from '@st/shared';
import { executeWorkflow, ExecutionFailure } from '@st/engine';
import type { AppContext } from '../context.js';
import { errorMessage, notFound } from '../errors.js';
import { failureMessage, stopWarning } from './failure.js';
import { settleTurn, type RunEnd } from './settle-turn.js';
import { announcedRuns, type PlannedRun, type StartedTurn } from './turn-start.js';
import { TurnStream, type TurnFrame } from './turn-stream.js';
import type { RunningTurn } from './turns.js';

/** How one reply run went. */
export type RunResult = {
  planned: PlannedRun;
  /** Absent only when the run failed with something that is not an engine failure. */
  execution?: ExecutionLog;
  /** Why it did not run to the end (an `ExecutionFailure` or anything else it threw); absent when it did. */
  failure?: unknown;
  /** The failure was a stop (the user, a client leaving, the server shutting down). */
  stopped: boolean;
  /** The assistant messages the run saved, partial rows included. */
  replies: ChatMessage[];
  /** How many replies the run's Chat Outputs produced (`replies` has them as saved, with partial rows). */
  produced: number;
  /** The turn's user message as saved: only the first run of a turn has it. */
  userMessage?: ChatMessage;
};

export type ReplyRunInput = {
  started: StartedTurn;
  planned: PlannedRun;
  /** The history the run starts from: the turn's, plus the replies the runs above it saved. */
  history: ChatMessage[];
  /**
   * What it starts from: the turn-start state plus what the runs above it committed, and the closure that folds that
   * same state again with the run's pending writes (`executeWorkflow`'s `foldWith`).
   */
  start: { state: StateSnapshot; issues: string[]; foldWith: (pending: StateWrite[]) => StateSnapshot };
  /** The replies the runs above it saved (Chat Input's `replies`), in chat order. */
  replies: ChatMessage[];
  /** Only for the first run of the turn, which stores the message. */
  userMessage?: ChatMessage;
  /** The runs above it. */
  earlier: readonly RunResult[];
  /** The turn's last reply-section run announces the after section in the write that settles it. */
  isLast: boolean;
  emit?: (frame: TurnFrame) => void;
};

// How a run ended: `failure` is what it threw, undefined when it ran to the end.
function runEnd(failure: unknown, turn: RunningTurn): RunEnd {
  if (failure === undefined) return { status: 'completed' };
  if (turn.stoppedBy) return { status: 'stopped' };
  return {
    status: 'error',
    error: failure instanceof ExecutionFailure ? failureMessage(failure) : errorMessage(failure),
  };
}

/**
 * Runs one workflow of the reply section and settles it into the session in its own update (the turn's first run
 * creates the entry, later ones add to it). When this is the section's last run and nothing was stopped, the runs of the
 * after section are announced in that same write (`running` in the entry), and `announced` says so: they then run once
 * the turn's result is sent. Never throws for the workflow's own failure.
 */
export async function runReplyRun(
  context: AppContext,
  sessionId: string,
  turn: RunningTurn,
  { started, planned, history, start, replies: above, userMessage, earlier, isLast, emit }: ReplyRunInput,
): Promise<{ result: RunResult; announced: boolean }> {
  const { sessions, executions, secrets } = context;
  const { prepared, runId, workflow } = planned;
  const turnId = started.turnId;
  const stream = emit
    ? new TurnStream({
        sessions: sessions.silent,
        sessionId,
        executionId: turnId,
        runId,
        alternativeOf: started.rootId,
        prepared,
        emit,
      })
    : undefined;
  let outcome: Awaited<ReturnType<typeof executeWorkflow>> | undefined;
  let failure: unknown;
  try {
    outcome = await executeWorkflow(prepared, {
      message: started.content,
      sessionId,
      history,
      secrets,
      character: started.character,
      persona: started.persona,
      settings: planned.settings,
      state: start.state,
      foldWith: start.foldWith,
      replies: above,
      signal: turn.controller.signal,
      executionId: runId,
      turnId,
      onEvent: stream?.onEvent,
    });
  } catch (error) {
    failure = error;
  }
  const streamed = (await stream?.finish()) ?? [];
  const failed = failure instanceof ExecutionFailure ? failure : undefined;
  const execution = outcome?.execution ?? failed?.execution;
  const replies = outcome?.replies ?? failed?.replies ?? [];
  // The writes of every node that completed, even when the run failed or was stopped.
  const writes = outcome?.writes ?? failed?.writes ?? [];
  // A stored value that no longer fits its declaration is ignored (the default runs); say so in the log.
  execution?.warnings.push(...planned.settingIssues, ...start.issues);
  const stoppedNow = !outcome && !!turn.stoppedBy;
  if (stoppedNow && execution) execution.warnings.push(stopWarning('turn', turn.stoppedBy!));
  if (execution) await executions.save(execution);
  // The after section follows a turn whose reply section ended without a stop, whether or not a workflow of it failed. A
  // regenerate that left no reply at all changes nothing in the chat: its turn is not present, so there is nothing to follow.
  const all = [...earlier, { stopped: stoppedNow, produced: replies.length }];
  const announced =
    isLast &&
    started.after.length > 0 &&
    !all.some((item) => item.stopped) &&
    !(started.rootId && all.every((item) => !item.produced));
  if (announced) for (const { runId: id } of started.after) turn.postRunIds.add(id);
  const end = runEnd(outcome ? undefined : (failure ?? new Error('The run failed')), turn);
  const settled: { value?: { userMessage?: ChatMessage; assistantMessages: ChatMessage[]; linkWarnings: string[] } } =
    {};
  // Everything a turn writes is silent; the settled turn announces itself once (see `executeTurn`).
  const session = await sessions.silent.update(sessionId, (current) => {
    settled.value = settleTurn(current, {
      executionId: turnId,
      run: { executionId: runId, workflowId: workflow.id, ...end },
      userMessage,
      replies,
      streamed,
      writes,
      definitions: started.definitions,
      postRuns: announced ? announcedRuns(started) : [],
      ...(started.rootId ? { regenerate: { rootId: started.rootId } } : {}),
    });
    return current;
  });
  if (!session) throw notFound('Session');
  const { userMessage: saved, assistantMessages, linkWarnings } = settled.value!;
  // A write dropped at commit time (the messages it links to changed during the run) is said in the log, which was saved
  // before the commit: save it again with the warning.
  if (execution && linkWarnings.length) {
    execution.warnings.push(...linkWarnings);
    await executions.save(execution);
  }
  return {
    result: {
      planned,
      ...(execution ? { execution } : {}),
      ...(outcome ? {} : { failure }),
      stopped: stoppedNow,
      replies: assistantMessages,
      produced: replies.length,
      userMessage: saved,
    },
    announced,
  };
}
