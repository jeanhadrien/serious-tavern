import type { Character, ChatMessage, ExecutionLog, Persona, PostRunResult, StateDefinition } from '@st/shared';
import { POST_INTERRUPTED_MESSAGE, readTurnEntries, turnPresence } from '@st/shared';
import { executeWorkflow, ExecutionFailure } from '@st/engine';
import type { PreparedWorkflow } from '@st/engine';
import type { AppContext } from '../context.js';
import { errorMessage } from '../errors.js';
import { failureMessage, stopWarning } from './failure.js';
import { settlePostRun } from './settle-post-run.js';
import { foldSession } from './story-state.js';
import type { RunningTurn } from './turns.js';

/**
 * What the after-reply run of one workflow of a settled turn needs: its reply run's own inputs, and what that run
 * produced. A turn leaves one per enabled workflow that has an After Reply part.
 */
export type PostTurn = {
  prepared: PreparedWorkflow;
  /** The workflow the run belongs to: the scope of the nodes' own state, and the run's record in the entry. */
  workflowId: string;
  /** The definitions the turn's ports were resolved with, so the run's ports and its state cannot disagree. */
  definitions: StateDefinition[];
  /** The turn, whose entry the run is listed in. */
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
  /** The settled assistant messages of the workflow's own reply run: what After Reply outputs. */
  replies: ChatMessage[];
};

type Outcome = { result: PostRunResult; execution?: ExecutionLog };

/**
 * The after-reply runs of a settled turn, one after another in list order (each settles into the turn's entry before the
 * next starts, so it reads what the ones before it wrote). They run in the turn's queue slot (`RunningTurn.after`), so
 * the next message waits for them and Stop stops the running one: the rest are then not run, and their records in the
 * entry (listed `running` when the turn settled) end as stopped, never left `running`.
 */
export async function runPostTurns(
  context: AppContext,
  sessionId: string,
  posts: readonly PostTurn[],
  run: RunningTurn,
): Promise<void> {
  for (const post of posts) {
    if (!run.stoppedBy) await runPostTurn(context, sessionId, post, run);
    else
      await settle(
        context,
        sessionId,
        post,
        run.stoppedBy === 'shutdown'
          ? { status: 'error', error: POST_INTERRUPTED_MESSAGE, writes: [] }
          : { status: 'stopped', writes: [] },
      );
  }
}

/**
 * Runs the after-reply part of a settled turn's workflow and records how it ended on its record in the turn's entry.
 * Whatever happens here stays here: a failure is the record's `error`, never the turn's, and nothing is thrown.
 */
async function runPostTurn(context: AppContext, sessionId: string, post: PostTurn, run: RunningTurn): Promise<void> {
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
  const warnings = await settle(context, sessionId, post, outcome.result);
  // A write dropped at commit time (its messages changed during the run) is said in the log, which was saved before the
  // commit: save it again with the warning.
  if (outcome.execution && warnings.length) {
    outcome.execution.warnings.push(...warnings);
    await context.executions.save(outcome.execution).catch((error) => {
      console.warn(`Could not save the after-reply execution log of session ${sessionId}:`, error);
    });
  }
}

const SETTLE_RETRY_MS = 100;

/**
 * Records the run's result on the turn's entry and announces it once. A write that fails is tried once more; if that
 * fails too, a minimal write records an honest error (without the writes), because an entry left `running` would later
 * read as a restart's casualty and lose the real outcome. Only when even that fails is it left to a warning.
 */
async function settle(
  context: AppContext,
  sessionId: string,
  post: PostTurn,
  result: PostRunResult,
): Promise<string[]> {
  const write = async (settlement: PostRunResult) => {
    let warnings: string[] = [];
    const updated = await context.sessions.silent.update(sessionId, (current) => {
      warnings = settlePostRun(current, {
        turnExecutionId: post.turnExecutionId,
        run: { executionId: post.executionId, workflowId: post.workflowId },
        definitions: post.definitions,
        ...settlement,
      });
      return current;
    });
    if (updated) context.changes.publish({ type: 'sessions.changed', id: sessionId });
    return warnings;
  };
  try {
    return await write(result);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_RETRY_MS));
  }
  try {
    return await write(result);
  } catch (error) {
    try {
      await write({
        status: 'error',
        error: `The result of the after-reply run could not be saved: ${errorMessage(error)}`,
        writes: [],
      });
    } catch (last) {
      console.warn(`Could not record the after-reply run of session ${sessionId}:`, last);
    }
  }
  return [];
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
  const story = foldSession(post.definitions, session, turn, post.history, { workflowId: post.workflowId });
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
    // The nodes that completed keep their writes, like in a failed turn. A user's stop is not an error; a shutdown
    // cut the run short like a restart would, and reads the same.
    execution = error.execution;
    result =
      run.stoppedBy === 'shutdown'
        ? { status: 'error', error: POST_INTERRUPTED_MESSAGE, writes: error.writes }
        : run.stoppedBy
          ? { status: 'stopped', writes: error.writes }
          : { status: 'error', error: failureMessage(error), writes: error.writes };
    if (run.stoppedBy) execution.warnings.push(stopWarning('after-reply run', run.stoppedBy));
  }
  execution.turnExecutionId = post.turnExecutionId;
  execution.warnings.push(...story.issues);
  return { result, execution };
}
