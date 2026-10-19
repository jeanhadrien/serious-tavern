import type { ChatMessage } from '@st/shared';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { runReplyRun, type RunResult } from './reply-run.js';
import { historyMessages, settleTurn } from './settle-turn.js';
import { announcedRuns, foldRun, type PlannedRun, type StartedTurn } from './turn-start.js';
import type { TurnFrame } from './turn-stream.js';
import type { RunningTurn } from './turns.js';

export type ReplySection = {
  /** The runs that ran, in list order. */
  results: RunResult[];
  /** The user message as saved (with the turn's id). */
  userMessage?: ChatMessage;
  /** A stop ended the section: the running runs, and the runs that therefore did not start. */
  stopped: boolean;
  /** The runs of the after section are announced in the turn's entry and still to run (`runAfterSection`). */
  announced: boolean;
};

/**
 * Counts the section's runs as they end, so that the last one to end can announce the after section in its own write:
 * every run reports exactly once, a run that never started (a stop came first) included. Reporting is synchronous, which
 * is what makes "the last" well defined whatever order the runs finish in.
 */
class SectionLedger {
  private ended = 0;
  private stopped = false;
  private produced = 0;

  constructor(
    private readonly total: number,
    private readonly started: Pick<StartedTurn, 'after' | 'rootId'>,
  ) {}

  /**
   * Whether this run's write announces the after section: it is the last to end, nothing was stopped, and (for a
   * regenerate, which changes nothing in the chat unless it replied) some run replied.
   */
  end(run: { stopped: boolean; produced: number }): boolean {
    this.ended++;
    this.stopped ||= run.stopped;
    this.produced += run.produced;
    return (
      this.ended === this.total &&
      this.started.after.length > 0 &&
      !this.stopped &&
      !(this.started.rootId && this.produced === 0)
    );
  }
}

/**
 * What a run of the reply section starts from. It reads the committed writes of the runs it waited for, and the chat as
 * it stands from their point of view: the turn's history, then (from the first reply on) the turn's user message, then the
 * replies of those runs in list order. Nothing of a run it did not wait for, even one that has settled meanwhile.
 */
async function viewOf(
  context: AppContext,
  sessionId: string,
  started: StartedTurn,
  planned: PlannedRun,
  results: readonly (RunResult | undefined)[],
) {
  const session = await context.sessions.silent.get(sessionId);
  if (!session) throw notFound('Session');
  const saved = historyMessages(planned.waitsFor.flatMap((position) => results[position]?.replies ?? []));
  // The message as the chat holds it once the turn has settled: stamped with the turn's id (a regenerate's already is).
  const asked = started.userMessage ? { ...started.userMessage, executionId: started.turnId } : started.asked;
  const ask = saved.length && asked && !started.history.some((message) => message.id === asked.id) ? [asked] : [];
  const history = [...started.history, ...ask, ...saved];
  const story = foldRun(started, session, planned, history);
  return { history, replies: saved, start: { state: story.snapshot, issues: story.issues } };
}

/**
 * The streamed section of a turn: the enabled workflows from the top of the list down to the last one that replies. A run
 * starts as soon as the earlier runs whose writes it reads have ended (`PlannedRun.waitsFor`), so workflows that cannot
 * affect each other run, and stream, at the same time. It starts from the turn-start state plus what those runs
 * committed, and from the turn-start history plus the replies they saved; each run settles in its own update of the
 * session, which stores its writes and replies in LIST order whichever finishes first. A run that fails keeps what it
 * completed and the runs after it still run; a stop ends every running run and the ones that have not started do not
 * start. A workflow's failure is in the results, never thrown. With no workflow that replies the section is empty: the
 * turn's entry is created at once, with the after section announced.
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
  const results: (RunResult | undefined)[] = runs.map(() => undefined);
  const ledger = new SectionLedger(runs.length, started);
  let announced = false;
  const outcomes = await Promise.allSettled(
    runs.map(async (planned) => {
      try {
        await started.board.until(planned.waitsFor);
        // A stop while it waited: the run does not start (and is not recorded). A run that waited for nothing starts with
        // the turn, and a stop that came first just ends it at once, as for the turn's first run.
        if (planned.waitsFor.length && turn.stoppedBy) {
          ledger.end({ stopped: true, produced: 0 });
          return;
        }
        const view = await viewOf(context, sessionId, started, planned, results);
        emit?.({
          type: 'run.start',
          runId: planned.runId,
          workflowId: planned.workflow.id,
          workflowName: planned.workflow.name,
          position: planned.position,
        });
        const done = await runReplyRun(context, sessionId, turn, {
          started,
          planned,
          ...view,
          userMessage: started.userMessage,
          ended: (end) => {
            const announce = ledger.end(end);
            announced ||= announce;
            return announce;
          },
          emit,
        });
        results[planned.position] = done.result;
      } finally {
        started.board.end(planned.position);
      }
    }),
  );
  // Whatever one run threw (the chat was deleted meanwhile), the others have ended by now; report it.
  const failed = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  const ran = results.filter((result): result is RunResult => result !== undefined);
  return {
    results: ran,
    userMessage: ran.find((result) => result.userMessage)?.userMessage ?? started.userMessage,
    stopped: ran.some((result) => result.stopped) || ran.length < runs.length,
    announced,
  };
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
