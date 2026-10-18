import type { Character, ChatMessage, ExecutionLog, Persona, PostRunResult, StateDefinition } from '@st/shared';
import { readTurnEntries, turnPresence } from '@st/shared';
import { executeWorkflow, ExecutionFailure } from '@st/engine';
import type { PreparedWorkflow } from '@st/engine';
import type { AppContext } from '../context.js';
import { errorMessage } from '../errors.js';
import { failureMessage, stopWarning } from './failure.js';
import { settlePostRun } from './settle-post-run.js';
import { foldSession } from './story-state.js';
import type { RunningTurn } from './turns.js';

/** What the after-reply run of a settled turn needs: the reply run's own inputs, and what the turn produced. */
export type PostTurn = {
  prepared: PreparedWorkflow;
  /** The definitions the turn's ports were resolved with, so the run's ports and its state cannot disagree. */
  definitions: StateDefinition[];
  /** The reply run, which the entry is on. */
  turnExecutionId: string;
  /** This run, announced in the entry before it started. */
  executionId: string;
  /** `postRunSeed` of the reply run's seed. */
  seed: string;
  message: string;
  /** The history the reply run had (before the turn's user message). */
  history: ChatMessage[];
  settings: Record<string, unknown>;
  character?: Character;
  persona?: Persona;
  /** The turn's settled assistant messages: what After Reply outputs. */
  replies: ChatMessage[];
};

type Outcome = { result: PostRunResult; execution?: ExecutionLog };

/**
 * Runs the after-reply part of a settled turn and records how it ended on the turn's entry. It runs in the turn's
 * queue slot (`RunningTurn.after`), so the next message waits for it and Stop stops it. Whatever happens here
 * stays here: a failure is the entry's `error`, never the turn's, and nothing is thrown.
 */
export async function runPostTurn(
  context: AppContext,
  sessionId: string,
  post: PostTurn,
  run: RunningTurn,
): Promise<void> {
  const outcome = await execute(context, sessionId, post, run).catch(
    (error): Outcome => ({ result: { status: 'error', error: errorMessage(error), writes: [] } }),
  );
  // The session was deleted meanwhile: nothing to run and nothing to settle.
  if (!outcome) return;
  if (outcome.execution)
    await context.executions.save(outcome.execution).catch((error) => {
      // A log that cannot be written must not leave the entry `running`.
      console.warn(`Could not save the after-reply execution log of session ${sessionId}:`, error);
    });
  try {
    const updated = await context.sessions.silent.update(sessionId, (current) => {
      settlePostRun(current, { turnExecutionId: post.turnExecutionId, ...outcome.result });
      return current;
    });
    if (updated) context.changes.publish({ type: 'sessions.changed', id: sessionId });
  } catch (error) {
    console.warn(`Could not record the after-reply run of session ${sessionId}:`, error);
  }
}

async function execute(
  context: AppContext,
  sessionId: string,
  post: PostTurn,
  run: RunningTurn,
): Promise<Outcome | undefined> {
  const session = await context.sessions.silent.get(sessionId);
  if (!session) return undefined;
  // The run reads the turn it follows, with the reply run's writes already in the fold. If its replies were
  // deleted meanwhile it reads where the chat stands.
  const presence = turnPresence(session.messages, readTurnEntries(session.state));
  const turn =
    presence.find(({ entry }) => entry.executionId === post.turnExecutionId)?.turn ??
    presence.filter((item) => item.turn !== null).length;
  const story = foldSession(post.definitions, session, turn);
  const { replies } = post;
  let execution: ExecutionLog;
  let result: PostRunResult;
  try {
    const done = await executeWorkflow(post.prepared, {
      part: 'post',
      afterReply: { replies, text: replies.map((reply) => reply.content).join('\n\n'), turn },
      message: post.message,
      sessionId,
      history: post.history,
      secrets: context.secrets,
      character: post.character,
      persona: post.persona,
      settings: post.settings,
      state: story.snapshot,
      seed: post.seed,
      executionId: post.executionId,
      signal: run.controller.signal,
    });
    execution = done.execution;
    result = { status: 'completed', writes: done.writes };
  } catch (error) {
    if (!(error instanceof ExecutionFailure))
      return { result: { status: 'error', error: errorMessage(error), writes: [] } };
    // The nodes that completed keep their writes, like in a failed turn; a stop is not an error.
    execution = error.execution;
    result = run.stoppedBy
      ? { status: 'stopped', writes: error.writes }
      : { status: 'error', error: failureMessage(error), writes: error.writes };
    if (run.stoppedBy) execution.warnings.push(stopWarning('after-reply run', run.stoppedBy));
  }
  execution.turnExecutionId = post.turnExecutionId;
  execution.warnings.push(...story.issues);
  return { result, execution };
}
