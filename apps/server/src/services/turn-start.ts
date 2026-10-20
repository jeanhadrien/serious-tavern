import { randomUUID } from 'node:crypto';
import type { Character, ChatMessage, Persona, Session, StateDefinition, StateSnapshot, Workflow } from '@st/shared';
import {
  replyWorkflows,
  resolveChatSettings,
  withoutLastTurnReplies,
  workflowSettings,
  type WorkflowInvalidDetails,
} from '@st/shared';
import { prepareWorkflow, type PreparedWorkflow } from '@st/engine';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound, requireEntity } from '../errors.js';
import { nodeResources } from './node-resources.js';
import { regenerateTarget } from './regenerate.js';
import { historyMessages } from './settle-turn.js';
import { foldSession, listDefinitions } from './story-state.js';

/** What starts a turn: a message (possibly empty), or a regenerate of the last turn, which stores no user message. */
export type TurnRequest = { content: string; regenerate?: false } | { content?: undefined; regenerate: true };

/** One enabled workflow of the chat's reply list, ready to run. */
export type PlannedRun = {
  workflow: Workflow;
  prepared: PreparedWorkflow;
  /** The run's execution id (and log id). The turn's first run's is the turn's id. */
  runId: string;
  /** The chat's settings resolved against THIS workflow's declarations, as the turn starts. */
  settings: Record<string, unknown>;
  settingIssues: string[];
};

export type StartedTurn = {
  /**
   * The reply section: the enabled workflows from the top of the list down to the last one that has a Chat Output node,
   * in list order. They run while the turn is answered. Empty when no enabled workflow has a Chat Output.
   */
  reply: PlannedRun[];
  /**
   * The after section: the enabled workflows below the reply section (none has a Chat Output). They run after the
   * turn's result is sent. Together with `reply` they are every enabled workflow, at least one, each prepared before
   * anything was stored.
   */
  after: PlannedRun[];
  /** The turn's id: the execution id of its first run, in whichever section it is. */
  turnId: string;
  // `trigger.message`: the sent text, or a regenerate's user message (`''` when there is none).
  content: string;
  // A regenerate only: the root of the alternatives its replies join.
  rootId?: string;
  // The listing the ports were resolved with: later runs fold their state against the same one.
  definitions: StateDefinition[];
  userMessage?: ChatMessage;
  // The turn's user message as the chat holds it: the one this send stores, or a regenerate's. Absent for an empty send.
  asked?: ChatMessage;
  // The history the turn starts from (before its user message); later runs add it and the replies saved before them.
  history: ChatMessage[];
  character?: Character;
  persona?: Persona;
  // What the first run starts from.
  state: StateSnapshot;
  stateIssues: string[];
};

/**
 * Stores the user message and answers what the turn runs on, in one update of the session. Every enabled workflow of the
 * reply list is prepared first, in list order: the first invalid one answers `WORKFLOW_INVALID` and a list with none
 * enabled `NO_ENABLED_WORKFLOW`, both before anything is stored.
 */
export async function startTurn(context: AppContext, sessionId: string, request: TurnRequest): Promise<StartedTurn> {
  const { workflows, sessions, personas, stateDefinitions } = context;
  const started: { value?: StartedTurn } = {};
  const session = await sessions.silent.update(sessionId, async (current) => {
    // Checked inside the queue slot, so it is judged on the chat as the regenerate finds it.
    const target = request.regenerate ? regenerateTarget(current.messages) : undefined;
    const content = target?.content ?? request.content ?? '';
    const listed = replyWorkflows(current).filter((entry) => entry.enabled);
    if (!listed.length)
      throw new HttpError(400, 'NO_ENABLED_WORKFLOW', 'The chat has no enabled workflow: switch one on to get a reply');
    // One listing serves the node ports and the fold, so a definition edited mid-turn cannot split them.
    const definitions = await listDefinitions(stateDefinitions);
    const runs: PlannedRun[] = [];
    for (const entry of listed) {
      const workflow = await requireEntity(workflows, entry.workflowId, 'Workflow');
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
      // The values are snapshotted here: a settings change during the run applies from the next turn.
      const settings = resolveChatSettings(workflowSettings(workflow), current.settings);
      runs.push({
        workflow,
        prepared,
        runId: randomUUID(),
        settings: settings.values,
        settingIssues: settings.issues.map(({ key, message }) => `Chat setting "${key}": ${message}.`),
      });
    }
    const first = runs[0]!;
    // The reply section ends at the last workflow that can reply: what is below it cannot, so it runs after the reply.
    const lastReplying = runs
      .map((run) => run.workflow.nodes.some((node) => node.type === 'chat-output'))
      .lastIndexOf(true);
    const character = current.characterId
      ? await first.prepared.resources.characters?.get(current.characterId)
      : undefined;
    const persona = current.personaId ? await personas.get(current.personaId) : undefined;
    // An empty send adds no user message: the turn runs on the history as it is.
    const userMessage: ChatMessage | undefined =
      !target && content.trim() ? { id: randomUUID(), role: 'user', content, createdAt: now() } : undefined;
    // The state the turn starts from: the turns still present, folded against the definitions as they are now.
    // A regenerate runs as if the last turn's replies (whichever alternative is shown) were not there.
    const history = target?.history ?? historyMessages(current.messages);
    const story = foldSession(definitions, target ? { ...current, messages: target.messages } : current, history, {
      workflowId: first.workflow.id,
    });
    started.value = {
      reply: runs.slice(0, lastReplying + 1),
      after: runs.slice(lastReplying + 1),
      turnId: first.runId,
      content,
      rootId: target?.rootId,
      definitions,
      userMessage,
      ...((userMessage ?? target?.user) && { asked: userMessage ?? target?.user }),
      history,
      character,
      persona,
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

/**
 * What a run after the turn's first starts from: the state folded over the chat as it stands, with the turn counted as
 * present whatever its replies (so it sees the writes of the runs above it, and `trigger.turn` is the turn's number).
 * A regenerate folds over the chat without the last turn's replies, whichever alternative is shown, like its first run.
 */
export function foldRun(
  started: Pick<StartedTurn, 'definitions' | 'rootId' | 'turnId'>,
  session: Pick<Session, 'messages' | 'state'>,
  planned: PlannedRun,
  history: ChatMessage[],
) {
  const messages = started.rootId ? (withoutLastTurnReplies(session.messages) ?? session.messages) : session.messages;
  return foldSession(started.definitions, { messages, state: session.state }, history, {
    workflowId: planned.workflow.id,
    including: started.turnId,
  });
}

/** The after section's runs as the turn's entry announces them while they are still to run. */
export const announcedRuns = (started: Pick<StartedTurn, 'after'>) =>
  started.after.map(({ runId: executionId, workflow }) => ({ executionId, workflowId: workflow.id }));
