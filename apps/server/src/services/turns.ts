import { KeyedLock } from '../storage/lock.js';

/** Why a running job was stopped: the user, the client's stream dropping, or the server shutting down. */
export type TurnStop = 'user' | 'disconnect' | 'shutdown';

export class RunningTurn {
  readonly controller = new AbortController();
  stoppedBy?: TurnStop;
  /**
   * The post-turn run (After Reply) this turn leaves behind. Set before the turn settles, so that a state read
   * can tell the run is live (`TurnRegistry.hasPostRun`) while the entry already says `running`.
   */
  postExecutionId?: string;
  /**
   * Follow-up work that runs in this turn's queue slot once `run` has delivered its result: the next message to
   * the session waits for it. It gets a RunningTurn of its own, which is what Stop stops. Set by the action.
   */
  after?: (run: RunningTurn) => Promise<void>;

  stop(by: TurnStop): void {
    if (this.stoppedBy) return;
    this.stoppedBy = by;
    this.controller.abort(by);
  }
}

/**
 * Keeps one job per session at a time (messages to one session stay sequential) and tracks the running one so it
 * can be stopped. This is in-process state, separate from the repository locks, so a turn can hold it across the
 * engine run without holding a storage lock.
 *
 * A turn can leave a follow-up (`RunningTurn.after`) that keeps the slot: `run` resolves with the turn's result
 * first, so the reply is delivered, and the slot is released only when the follow-up ends. The follow-up cannot be
 * a second `run`: that would queue behind a message already waiting.
 */
export class TurnRegistry {
  private readonly queue = new KeyedLock();
  private readonly running = new Map<string, RunningTurn>();
  private readonly jobs = new Set<Promise<void>>();
  private closing = false;

  run<R>(sessionId: string, action: (turn: RunningTurn) => Promise<R>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const job: Promise<void> = this.queue
        .run(sessionId, async () => {
          const turn = this.start(sessionId);
          try {
            try {
              resolve(await action(turn));
            } catch (error) {
              reject(error);
            }
            if (turn.after) await this.follow(sessionId, turn, turn.after);
          } finally {
            this.running.delete(sessionId);
          }
        })
        .catch(() => undefined)
        .finally(() => this.jobs.delete(job));
      this.jobs.add(job);
    });
  }

  // Idempotent: stopping when nothing runs is a no-op. Stops whichever job runs: the turn, or its follow-up.
  stop(sessionId: string): void {
    this.running.get(sessionId)?.stop('user');
  }

  /** Whether the post-turn run `executionId` of the session is still to run or running (its turn holds the slot). */
  hasPostRun(sessionId: string, executionId: string): boolean {
    return this.running.get(sessionId)?.postExecutionId === executionId;
  }

  /**
   * For the server's shutdown: stops every running job and waits until all of them, queued ones included, have
   * ended. A job that starts meanwhile is stopped as it starts. Never rejects.
   */
  async close(): Promise<void> {
    this.closing = true;
    while (this.jobs.size) {
      for (const turn of this.running.values()) turn.stop('shutdown');
      await Promise.race(this.jobs);
    }
  }

  private start(sessionId: string): RunningTurn {
    const turn = new RunningTurn();
    if (this.closing) turn.stop('shutdown');
    this.running.set(sessionId, turn);
    return turn;
  }

  // A follow-up never rejects the queue or the caller (who already has the result): it can only be logged.
  private async follow(sessionId: string, turn: RunningTurn, after: NonNullable<RunningTurn['after']>): Promise<void> {
    const run = this.start(sessionId);
    run.postExecutionId = turn.postExecutionId;
    try {
      await after(run);
    } catch (error) {
      console.warn(`A follow-up of the turn of session ${sessionId} failed:`, error);
    }
  }
}
