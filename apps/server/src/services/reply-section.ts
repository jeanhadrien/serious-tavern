import type { ChatMessage } from '@st/shared';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { runReplyRun, type RunResult } from './reply-run.js';
import { historyMessages, settleTurn } from './settle-turn.js';
import { announcedRuns, foldRun, type StartedTurn } from './turn-start.js';
import type { TurnFrame } from './turn-stream.js';
import type { RunningTurn } from './turns.js';

export type ReplySection = {
  results: RunResult[];
  /** The user message as saved (with the turn's id). */
  userMessage?: ChatMessage;
  /** A stop ended the section: the running run, and the runs after it that therefore did not run. */
  stopped: boolean;
  /** The runs of the after section are announced in the turn's entry and still to run (`runAfterSection`). */
  announced: boolean;
};

/**
 * The streamed section of a turn: the enabled workflows from the top of the list down to the last one that replies, one
 * after another, in list order. Run k starts from the turn-start state plus what the runs above it committed (their
 * writes), and from the turn-start history plus the replies they saved; each run settles in its own update of the
 * session. A run that fails keeps what it completed and the runs after it still run; a stop ends the running run and the
 * rest do not run. A workflow's failure is in the results, never thrown. With no workflow that replies the section is
 * empty: the turn's entry is created at once, with the after section announced.
 */
export async function runReplySection(
  context: AppContext,
  sessionId: string,
  turn: RunningTurn,
  started: StartedTurn,
  emit?: (frame: TurnFrame) => void,
): Promise<ReplySection> {
  const { reply: runs } = started;
  if (!runs.length) return settleEmptySection(context, sessionId, turn, started);
  const results: RunResult[] = [];
  let history = started.history;
  let userMessage = started.userMessage;
  let start = { state: started.state, issues: started.stateIssues };
  let replies: ChatMessage[] = [];
  let stopped = false;
  let announced = false;
  for (const [index, planned] of runs.entries()) {
    if (index > 0) {
      // A stop between two runs ends the section: the runs that are left do not run (and are not recorded).
      if (turn.stoppedBy) {
        stopped = true;
        break;
      }
      const session = await context.sessions.silent.get(sessionId);
      if (!session) throw notFound('Session');
      const story = foldRun(started, session, planned, history);
      start = { state: story.snapshot, issues: story.issues };
    }
    emit?.({
      type: 'run.start',
      runId: planned.runId,
      workflowId: planned.workflow.id,
      workflowName: planned.workflow.name,
    });
    const done = await runReplyRun(context, sessionId, turn, {
      started,
      planned,
      history,
      start,
      replies,
      userMessage: index === 0 ? userMessage : undefined,
      earlier: results,
      isLast: index === runs.length - 1,
      emit,
    });
    results.push(done.result);
    announced = done.announced;
    userMessage = done.result.userMessage ?? userMessage;
    // Like the chat itself: from the first reply on, the turn's user message precedes the replies the next runs read.
    const saved = historyMessages(done.result.replies);
    const asked = userMessage ?? started.asked;
    const ask = saved.length && asked && !history.some((message) => message.id === asked.id) ? [asked] : [];
    history = [...history, ...ask, ...saved];
    replies = [...replies, ...saved];
    if (done.result.stopped) {
      stopped = true;
      break;
    }
  }
  return { results, userMessage, stopped, announced };
}

// No workflow can reply: the turn is complete at once (a regenerate, which must reply to change the chat, is not). The
// write that creates its entry announces the after section, which then holds every workflow of the list.
async function settleEmptySection(
  context: AppContext,
  sessionId: string,
  turn: RunningTurn,
  started: StartedTurn,
): Promise<ReplySection> {
  const announced = started.after.length > 0 && !started.rootId;
  if (announced) for (const { runId } of started.after) turn.postRunIds.add(runId);
  const settled: { userMessage?: ChatMessage } = {};
  const session = await context.sessions.silent.update(sessionId, (current) => {
    settled.userMessage = settleTurn(current, {
      executionId: started.turnId,
      userMessage: started.userMessage,
      replies: [],
      streamed: [],
      postRuns: announced ? announcedRuns(started) : [],
      ...(started.rootId ? { regenerate: { rootId: started.rootId } } : {}),
    }).userMessage;
    return current;
  });
  if (!session) throw notFound('Session');
  return { results: [], userMessage: settled.userMessage, stopped: false, announced };
}
