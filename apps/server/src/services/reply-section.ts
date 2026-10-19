import type { ChatMessage } from '@st/shared';
import { withoutLastTurnReplies } from '@st/shared';
import { postRunSeed } from '@st/engine';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import type { PostTurn } from './post-turn.js';
import { runReplyPart, type RunResult } from './reply-run.js';
import { historyMessages } from './settle-turn.js';
import { foldSession } from './story-state.js';
import type { StartedTurn } from './turn-start.js';
import type { TurnFrame } from './turn-stream.js';
import type { RunningTurn } from './turns.js';

export type ReplySection = {
  results: RunResult[];
  /** The user message as saved (with the turn's id). */
  userMessage?: ChatMessage;
  /** A stop ended the section: the running run, and the runs after it that therefore did not run. */
  stopped: boolean;
  /** The after-reply runs the turn leaves, announced in the entry and still to run, in list order. */
  posts: PostTurn[];
};

/**
 * The streamed section of a turn: the reply part of each enabled workflow, one after another, in list order. Run k
 * starts from the turn-start state plus what the runs above it committed (their writes), and from the turn-start history
 * plus the replies they saved; each run settles in its own update of the session. A run that fails keeps what it
 * completed and the runs after it still run; a stop ends the running run and the rest do not run. A workflow's failure is
 * in the results, never thrown.
 */
export async function runReplySection(
  context: AppContext,
  sessionId: string,
  turn: RunningTurn,
  started: StartedTurn,
  emit?: (frame: TurnFrame) => void,
): Promise<ReplySection> {
  const { runs, rootId, definitions } = started;
  const turnId = runs[0]!.runId;
  const results: RunResult[] = [];
  let history = started.history;
  let userMessage = started.userMessage;
  let start = { state: started.state, issues: started.stateIssues };
  let stopped = false;
  let announced: Map<string, string> | undefined;
  for (const [index, planned] of runs.entries()) {
    if (index > 0) {
      // A stop between two runs ends the section: the runs that are left do not run (and are not recorded).
      if (turn.stoppedBy) {
        stopped = true;
        break;
      }
      const session = await context.sessions.silent.get(sessionId);
      if (!session) throw notFound('Session');
      // The turn counts as present whatever its replies, and a regenerate is judged without the shown alternatives.
      const messages = rootId ? (withoutLastTurnReplies(session.messages) ?? session.messages) : session.messages;
      const story = foldSession(definitions, { messages, state: session.state }, undefined, history, {
        workflowId: planned.workflow.id,
        including: turnId,
      });
      start = { state: story.snapshot, issues: story.issues };
    }
    emit?.({
      type: 'run.start',
      runId: planned.runId,
      workflowId: planned.workflow.id,
      workflowName: planned.workflow.name,
    });
    const done = await runReplyPart(context, sessionId, turn, {
      started,
      planned,
      history,
      start,
      userMessage: index === 0 ? userMessage : undefined,
      earlier: results,
      isLast: index === runs.length - 1,
      emit,
    });
    results.push(done.result);
    announced = done.announced;
    userMessage = done.result.userMessage ?? userMessage;
    // Like the chat itself: from the first reply on, the turn's user message precedes the replies the next runs read.
    const replied = historyMessages(done.result.replies);
    const asked = userMessage ?? started.asked;
    const ask = replied.length && asked && !history.some((message) => message.id === asked.id) ? [asked] : [];
    history = [...history, ...ask, ...replied];
    if (done.result.stopped) {
      stopped = true;
      break;
    }
  }
  const posts = results.flatMap(({ planned, execution, replies, history: had }): PostTurn[] => {
    const executionId = announced?.get(planned.runId);
    if (!executionId) return [];
    return [
      {
        prepared: planned.prepared,
        workflowId: planned.workflow.id,
        definitions,
        turnExecutionId: turnId,
        executionId,
        seed: postRunSeed(execution?.seed ?? planned.runId),
        message: started.content,
        history: had,
        settings: planned.settings,
        character: started.character,
        persona: started.persona,
        replies,
      },
    ];
  });
  return { results, userMessage, stopped, posts };
}
