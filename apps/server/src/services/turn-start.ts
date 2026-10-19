import { randomUUID } from 'node:crypto';
import type { Character, ChatMessage, Persona, Session, StateDefinition, Workflow } from '@st/shared';
import {
  predecessors,
  replyWorkflows,
  resolveChatSettings,
  withoutLastTurnReplies,
  workflowSettings,
  type WorkflowInvalidDetails,
} from '@st/shared';
import type { PreparedWorkflow } from '@st/engine';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound } from '../errors.js';
import { prepareList, runAccess, sessionCards } from './reply-list.js';
import { regenerateTarget } from './regenerate.js';
import { RunBoard } from './run-board.js';
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
  /** The run's index among the enabled workflows, in list order. */
  position: number;
  /**
   * The positions of the earlier runs it waits for: those whose writes overlap what it reads (`predecessors`). It starts
   * once they have ended, and sees what they committed and replied, and nothing of any other run.
   */
  waitsFor: number[];
  /** The chat's settings resolved against THIS workflow's declarations, as the turn starts. */
  settings: Record<string, unknown>;
  settingIssues: string[];
};

export type StartedTurn = {
  /** Every enabled workflow of the chat's list, in list order: at least one, each prepared before anything was stored. */
  runs: PlannedRun[];
  /**
   * The reply section: the enabled workflows from the top of the list down to the last one that has a Chat Output node,
   * in list order. They run while the turn is answered, at the same time where they can. Empty when no enabled workflow
   * has a Chat Output.
   */
  reply: PlannedRun[];
  /**
   * The after section: the enabled workflows below the reply section (none of them has a Chat Output). They run after the
   * turn's result is sent.
   */
  after: PlannedRun[];
  /** Which runs have ended: what a run waits on, across both sections. */
  board: RunBoard;
  /** The turn's id: the execution id of its first run, in whichever section it is. */
  turnId: string;
  // `trigger.message`: the sent text, or a regenerate's user message (`''` when there is none).
  content: string;
  // A regenerate only: the root of the alternatives its replies join.
  rootId?: string;
  // The listing the ports were resolved with: every run folds its state against the same one.
  definitions: StateDefinition[];
  userMessage?: ChatMessage;
  // The turn's user message as the chat holds it: the one this send stores, or a regenerate's. Absent for an empty send.
  asked?: ChatMessage;
  // The history the turn starts from (before its user message); a run adds the user message and the replies of the runs it waited for.
  history: ChatMessage[];
  character?: Character;
  persona?: Persona;
};

/**
 * Stores the user message and answers what the turn runs on, in one update of the session. Every enabled workflow of the
 * reply list is prepared first, in list order: the first invalid one answers `WORKFLOW_INVALID` and a list with none
 * enabled `NO_ENABLED_WORKFLOW`, both before anything is stored. Each run's access (what it reads and writes of the
 * chat's shared data) decides which earlier runs it waits for.
 */
export async function startTurn(context: AppContext, sessionId: string, request: TurnRequest): Promise<StartedTurn> {
  const { sessions, stateDefinitions } = context;
  const started: { value?: StartedTurn } = {};
  const session = await sessions.silent.update(sessionId, async (current) => {
    // Checked inside the queue slot, so it is judged on the chat as the regenerate finds it.
    const target = request.regenerate ? regenerateTarget(current.messages) : undefined;
    const content = target?.content ?? request.content ?? '';
    const enabled = replyWorkflows(current).filter((entry) => entry.enabled);
    if (!enabled.length)
      throw new HttpError(400, 'NO_ENABLED_WORKFLOW', 'The chat has no enabled workflow: switch one on to get a reply');
    // One listing serves the node ports, the templates' references and the fold, so a definition edited mid-turn cannot split them.
    const definitions = await listDefinitions(stateDefinitions);
    const planned: Omit<PlannedRun, 'waitsFor'>[] = [];
    for (const { entry, workflow, prepared, issues } of await prepareList(context, enabled, definitions)) {
      if (!workflow) throw notFound('Workflow');
      if (!prepared)
        throw new HttpError(400, 'WORKFLOW_INVALID', `Workflow "${workflow.name}" is invalid`, {
          workflowId: entry.workflowId,
          workflowName: workflow.name,
          issues,
        } satisfies WorkflowInvalidDetails);
      // The values are snapshotted here: a settings change during the run applies from the next turn.
      const settings = resolveChatSettings(workflowSettings(workflow), current.settings);
      planned.push({
        workflow,
        prepared,
        runId: randomUUID(),
        position: planned.length,
        settings: settings.values,
        settingIssues: settings.issues.map(({ key, message }) => `Chat setting "${key}": ${message}.`),
      });
    }
    const cards = await sessionCards(context, current, planned[0]!.prepared.resources);
    const waits = predecessors(planned.map(({ prepared }) => runAccess(prepared, cards, definitions)));
    const runs = planned.map((run, index): PlannedRun => ({ ...run, waitsFor: waits[index]! }));
    const first = runs[0]!;
    // The reply section ends at the last workflow that can reply: what is below it cannot, so it runs after the reply.
    const lastReplying = runs
      .map((run) => run.workflow.nodes.some((node) => node.type === 'chat-output'))
      .lastIndexOf(true);
    // An empty send adds no user message: the turn runs on the history as it is.
    const userMessage: ChatMessage | undefined =
      !target && content.trim() ? { id: randomUUID(), role: 'user', content, createdAt: now() } : undefined;
    // A regenerate runs as if the last turn's replies (whichever alternative is shown) were not there.
    const history = target?.history ?? historyMessages(current.messages);
    started.value = {
      runs,
      reply: runs.slice(0, lastReplying + 1),
      after: runs.slice(lastReplying + 1),
      board: new RunBoard(runs.length),
      turnId: first.runId,
      content,
      rootId: target?.rootId,
      definitions,
      userMessage,
      ...((userMessage ?? target?.user) && { asked: userMessage ?? target?.user }),
      history,
      ...cards,
    };
    if (userMessage) current.messages.push(userMessage);
    current.updatedAt = now();
    return current;
  });
  if (!session) throw notFound('Session');
  return started.value!;
}

/**
 * What a run starts from: the state folded over the chat as it stands, with the turn counted as present whatever its
 * replies, and of the turn's own writes only those of the runs it waited for (so a run sees what the runs it reads from
 * committed, and nothing a run listed below it, or one it did not wait for, happened to commit first). `trigger.turn` is the
 * turn's number. A regenerate folds over the chat without the last turn's replies, whichever alternative is shown.
 */
export function foldRun(
  started: Pick<StartedTurn, 'definitions' | 'rootId' | 'runs' | 'turnId'>,
  session: Pick<Session, 'messages' | 'state'>,
  planned: PlannedRun,
  history: ChatMessage[],
) {
  const messages = started.rootId ? (withoutLastTurnReplies(session.messages) ?? session.messages) : session.messages;
  return foldSession(started.definitions, { messages, state: session.state }, history, {
    workflowId: planned.workflow.id,
    including: started.turnId,
    visibleRuns: new Set(planned.waitsFor.map((position) => started.runs[position]!.runId)),
  });
}

/** The execution ids of the runs `planned` waited for, in list order (`ExecutionLog.waitedFor`). */
export const waitedFor = (started: Pick<StartedTurn, 'runs'>, planned: PlannedRun): string[] =>
  planned.waitsFor.map((position) => started.runs[position]!.runId);

/** The after section's runs as the turn's entry announces them while they are still to run. */
export const announcedRuns = (started: Pick<StartedTurn, 'after'>) =>
  started.after.map(({ runId: executionId, workflow, position }) => ({
    executionId,
    workflowId: workflow.id,
    position,
  }));
