import { randomUUID } from 'node:crypto';
import type {
  ApiResponse,
  Character,
  ChatMessage,
  ExecutionLog,
  Persona,
  StateSnapshot,
  StateWrite,
  WorkflowInvalidDetails,
} from '@st/shared';
import { resolveChatSettings, workflowSettings } from '@st/shared';
import type { StateDefinition } from '@st/shared';
import { executeWorkflow, ExecutionFailure, postRunSeed, prepareWorkflow } from '@st/engine';
import type { ChatReply, PreparedWorkflow } from '@st/engine';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound, requireEntity } from '../errors.js';
import { failureMessage, stopWarning } from './failure.js';
import { nodeResources } from './node-resources.js';
import { runPostTurn } from './post-turn.js';
import { historyMessages, settleTurn } from './settle-turn.js';
import { foldSession, listDefinitions } from './story-state.js';
import { TurnStream, type TurnFrame } from './turn-stream.js';
import type { RunningTurn } from './turns.js';

export type TurnOptions = {
  // Receives the turn's events. Passing it streams passthrough Chat Outputs live.
  emit?: (frame: TurnFrame) => void;
  // Aborts the turn when the stream's client disconnects.
  signal?: AbortSignal;
};

export function sendMessage(
  context: AppContext,
  sessionId: string,
  content: string,
): Promise<ApiResponse<'sendMessage'>> {
  return runTurn(context, sessionId, content);
}

// One turn per session, in order. The session's storage lock is only held for short writes, never across the engine run.
export function runTurn(
  context: AppContext,
  sessionId: string,
  content: string,
  options: TurnOptions = {},
): Promise<ApiResponse<'sendMessage'>> {
  return context.turns.run(sessionId, async (turn) => {
    if (options.signal?.aborted) throw new HttpError(409, 'TURN_STOPPED', 'The turn was cancelled before it started');
    const disconnected = () => turn.stop('disconnect');
    options.signal?.addEventListener('abort', disconnected, { once: true });
    try {
      return await executeTurn(context, sessionId, content, turn, options);
    } finally {
      options.signal?.removeEventListener('abort', disconnected);
    }
  });
}

async function startTurn(context: AppContext, sessionId: string, content: string) {
  const { workflows, sessions, personas, stateDefinitions } = context;
  const started: {
    value?: {
      prepared: PreparedWorkflow;
      // The listing the ports were resolved with: the after-reply run folds its state against the same one.
      definitions: StateDefinition[];
      userMessage?: ChatMessage;
      history: ChatMessage[];
      character?: Character;
      persona?: Persona;
      settings: Record<string, unknown>;
      settingIssues: string[];
      state: StateSnapshot;
      stateIssues: string[];
    };
  } = {};
  const session = await sessions.silent.update(sessionId, async (current) => {
    const workflow = await requireEntity(workflows, current.workflowId, 'Workflow');
    // One listing serves the node ports and the fold, so a definition edited mid-turn cannot split them.
    const definitions = await listDefinitions(stateDefinitions);
    const { errors, prepared } = await prepareWorkflow(workflow, {
      ...nodeResources(context),
      stateDefinitions: { get: async (id) => definitions.find((definition) => definition.id === id) },
    });
    if (!prepared)
      throw new HttpError(400, 'WORKFLOW_INVALID', `Workflow "${workflow.name}" is invalid`, {
        workflowId: workflow.id,
        workflowName: workflow.name,
        issues: errors,
      } satisfies WorkflowInvalidDetails);
    const character = current.characterId ? await prepared.resources.characters?.get(current.characterId) : undefined;
    const persona = current.personaId ? await personas.get(current.personaId) : undefined;
    // An empty send adds no user message: the turn runs on the history as it is.
    const userMessage: ChatMessage | undefined = content.trim()
      ? { id: randomUUID(), role: 'user', content, createdAt: now() }
      : undefined;
    // The values are snapshotted here: a settings change during the run applies from the next turn.
    const settings = resolveChatSettings(workflowSettings(workflow), current.settings);
    // The state the turn starts from: the turns still present, folded against the definitions as they are now.
    const story = foldSession(definitions, current);
    started.value = {
      prepared,
      definitions,
      userMessage,
      history: historyMessages(current.messages),
      character,
      persona,
      settings: settings.values,
      settingIssues: settings.issues.map(({ key, message }) => `Chat setting "${key}": ${message}.`),
      state: story.snapshot,
      stateIssues: story.issues,
    };
    if (userMessage) current.messages.push(userMessage);
    current.updatedAt = now();
    return current;
  });
  if (!session) throw notFound('Session');
  return started.value!;
}

async function executeTurn(
  context: AppContext,
  sessionId: string,
  content: string,
  turn: RunningTurn,
  options: TurnOptions,
): Promise<ApiResponse<'sendMessage'>> {
  const { sessions, executions, secrets } = context;
  const {
    prepared,
    definitions,
    userMessage,
    history,
    character,
    persona,
    settings,
    settingIssues,
    state,
    stateIssues,
  } = await startTurn(context, sessionId, content);
  const executionId = randomUUID();
  const stream = options.emit
    ? new TurnStream({ sessions: sessions.silent, sessionId, executionId, prepared, emit: options.emit })
    : undefined;
  options.emit?.({ type: 'turn.start', executionId });
  let outcome: { replies: ChatReply[]; execution: ExecutionLog; writes: StateWrite[] } | undefined;
  let failure: unknown;
  try {
    outcome = await executeWorkflow(prepared, {
      message: content,
      sessionId,
      history,
      secrets,
      character,
      persona,
      settings,
      state,
      signal: turn.controller.signal,
      executionId,
      onEvent: stream?.onEvent,
    });
  } catch (error) {
    failure = error;
  }
  const streamed = (await stream?.finish()) ?? [];
  const execution = outcome?.execution ?? (failure instanceof ExecutionFailure ? failure.execution : undefined);
  const replies = outcome?.replies ?? (failure instanceof ExecutionFailure ? failure.replies : []);
  // The writes of every node that completed, even when the turn failed or was stopped.
  const writes = outcome?.writes ?? (failure instanceof ExecutionFailure ? failure.writes : []);
  // A stored value that no longer fits its declaration is ignored (the default runs); say so in the log.
  execution?.warnings.push(...settingIssues, ...stateIssues);
  if (!outcome && turn.stoppedBy && execution) execution.warnings.push(stopWarning('turn', turn.stoppedBy));
  if (execution) await executions.save(execution);
  // A turn that ran to the end leaves an after-reply run when the workflow has one. It is announced in the entry
  // (`running`) by the settle below, and its id is on the RunningTurn first, so a state read can tell it is live.
  const postExecutionId = outcome && prepared.parts.postSinks.length ? randomUUID() : undefined;
  if (postExecutionId) turn.postExecutionId = postExecutionId;
  const settled: { value?: { userMessage?: ChatMessage; assistantMessages: ChatMessage[] } } = {};
  // Everything a turn writes is silent; the settled turn announces itself once (success, failure or stop).
  const session = await sessions.silent.update(sessionId, (current) => {
    settled.value = settleTurn(current, {
      executionId,
      userMessage,
      replies,
      streamed,
      interrupted: !outcome,
      writes,
      postExecutionId,
    });
    return current;
  });
  if (!session) throw notFound('Session');
  context.changes.publish({ type: 'sessions.changed', id: sessionId });
  const { userMessage: saved, assistantMessages } = settled.value!;
  // The reply is complete for the client. The after-reply run follows in this turn's queue slot, after the
  // caller has its result.
  if (postExecutionId && outcome)
    turn.after = (run) =>
      runPostTurn(
        context,
        sessionId,
        {
          prepared,
          definitions,
          turnExecutionId: executionId,
          executionId: postExecutionId,
          seed: postRunSeed(outcome.execution.seed ?? executionId),
          message: content,
          history,
          settings,
          character,
          persona,
          replies: assistantMessages,
        },
        run,
      );
  if (outcome) return { userMessage: saved, assistantMessages, execution: outcome.execution };
  if (!(failure instanceof ExecutionFailure)) throw failure;
  const details = { execution: failure.execution, userMessage: saved, assistantMessages };
  if (turn.stoppedBy)
    throw new HttpError(409, 'TURN_STOPPED', 'The turn was stopped before it finished', {
      ...details,
      aborted: turn.stoppedBy,
    });
  const message = failureMessage(failure);
  throw new HttpError(500, 'WORKFLOW_EXECUTION_FAILED', message, details);
}
