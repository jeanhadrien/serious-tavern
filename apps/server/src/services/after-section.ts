import type { ExecutionLog, PostRunResult } from '@st/shared';
import { POST_INTERRUPTED_MESSAGE } from '@st/shared';
import { executeWorkflow, ExecutionFailure } from '@st/engine';
import type { AppContext } from '../context.js';
import { errorMessage } from '../errors.js';
import { failureMessage, stopWarning } from './failure.js';
import { settleAfterRun } from './settle-after-run.js';
import { historyMessages } from './settle-turn.js';
import { foldRun, waitedFor, type PlannedRun, type StartedTurn } from './turn-start.js';
import type { RunningTurn } from './turns.js';

type Outcome = { result: PostRunResult; execution?: ExecutionLog };

/**
 * The runs of a turn's after section: the enabled workflows below the last one that replies. Like the reply section, a
 * run starts once the earlier runs whose writes it reads have ended (the reply section's all have), so those that cannot
 * affect each other run at the same time; each settles into the turn's entry, which stores everything in list order, so it
 * reads what the runs it waited for wrote. They run in the turn's queue slot (`RunningTurn.after`), after the turn's result
 * was sent: the next message waits for them and Stop stops every running one, and the ones that have not started are then
 * not run: their records in the entry (listed `running` when the reply section settled) end as stopped, never left `running`.
 */
export async function runAfterSection(
  context: AppContext,
  sessionId: string,
  started: StartedTurn,
  run: RunningTurn,
): Promise<void> {
  await Promise.all(
    started.after.map(async (planned) => {
      try {
        await started.board.until(planned.waitsFor);
        if (!run.stoppedBy) await runAfterRun(context, sessionId, started, planned, run);
        else
          await settle(
            context,
            sessionId,
            started,
            planned,
            run.stoppedBy === 'shutdown'
              ? { status: 'error', error: POST_INTERRUPTED_MESSAGE, writes: [] }
              : { status: 'stopped', writes: [] },
          );
      } finally {
        started.board.end(planned.position);
      }
    }),
  );
}

/**
 * Runs one workflow of the after section and records how it ended on its record in the turn's entry. Whatever happens
 * here stays here: a failure is the record's `error`, never the turn's, and nothing is thrown.
 */
async function runAfterRun(
  context: AppContext,
  sessionId: string,
  started: StartedTurn,
  planned: PlannedRun,
  run: RunningTurn,
): Promise<void> {
  const outcome = await execute(context, sessionId, started, planned, run).catch(
    (error): Outcome => ({ result: { status: 'error', error: errorMessage(error), writes: [] } }),
  );
  // The session was deleted meanwhile: nothing to run and nothing to settle.
  if (!outcome) return;
  const save = (execution: ExecutionLog) =>
    context.executions.save(execution).catch((error) => {
      // A log that cannot be written must not leave the entry `running`.
      console.warn(`Could not save the execution log of a run after the reply of session ${sessionId}:`, error);
    });
  if (outcome.execution) await save(outcome.execution);
  const warnings = await settle(context, sessionId, started, planned, outcome.result);
  // A write dropped at commit time (its messages changed during the run) is said in the log, which was saved before the
  // commit: save it again with the warning.
  if (outcome.execution && warnings.length) {
    outcome.execution.warnings.push(...warnings);
    await save(outcome.execution);
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
  started: StartedTurn,
  planned: PlannedRun,
  result: PostRunResult,
): Promise<string[]> {
  const write = async (settlement: PostRunResult) => {
    let warnings: string[] = [];
    const updated = await context.sessions.silent.update(sessionId, (current) => {
      warnings = settleAfterRun(current, {
        turnExecutionId: started.turnId,
        run: { executionId: planned.runId, workflowId: planned.workflow.id, position: planned.position },
        definitions: started.definitions,
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
        error: `The result of the run could not be saved: ${errorMessage(error)}`,
        writes: [],
      });
    } catch (last) {
      console.warn(`Could not record a run after the reply of session ${sessionId}:`, last);
    }
  }
  return [];
}

async function execute(
  context: AppContext,
  sessionId: string,
  started: StartedTurn,
  planned: PlannedRun,
  run: RunningTurn,
): Promise<Outcome | undefined> {
  const session = await context.sessions.silent.get(sessionId);
  if (!session) return undefined;
  // The run reads the chat as it stands (the user message, then the replies) and what the runs above it wrote: the
  // turn counts as present even if its replies were deleted meanwhile.
  const history = historyMessages(session.messages);
  const story = foldRun(started, session, planned, history);
  const replies = history.filter((message) => message.role === 'assistant' && message.executionId === started.turnId);
  let execution: ExecutionLog;
  let result: PostRunResult;
  try {
    const done = await executeWorkflow(planned.prepared, {
      message: started.content,
      sessionId,
      history,
      secrets: context.secrets,
      character: started.character,
      persona: started.persona,
      settings: planned.settings,
      state: story.snapshot,
      replies,
      executionId: planned.runId,
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
    if (run.stoppedBy) execution.warnings.push(stopWarning('run after the reply', run.stoppedBy));
  }
  execution.part = 'post';
  execution.turnExecutionId = started.turnId;
  execution.waitedFor = waitedFor(started, planned);
  execution.warnings.push(...planned.settingIssues, ...story.issues);
  return { result, execution };
}
