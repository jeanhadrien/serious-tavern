import { KeyedLock } from '../storage/lock.js';

export type TurnStop = 'user' | 'disconnect';

export class RunningTurn {
  readonly controller = new AbortController();
  stoppedBy?: TurnStop;

  stop(by: TurnStop): void {
    if (this.stoppedBy) return;
    this.stoppedBy = by;
    this.controller.abort(by);
  }
}

/**
 * Keeps one turn per session at a time (messages to one session stay sequential) and tracks the
 * running turn so it can be stopped. This is in-process state, separate from the repository locks,
 * so a turn can hold it across the engine run without holding a storage lock.
 */
export class TurnRegistry {
  private readonly queue = new KeyedLock();
  private readonly running = new Map<string, RunningTurn>();

  run<R>(sessionId: string, action: (turn: RunningTurn) => Promise<R>): Promise<R> {
    return this.queue.run(sessionId, async () => {
      const turn = new RunningTurn();
      this.running.set(sessionId, turn);
      try {
        return await action(turn);
      } finally {
        this.running.delete(sessionId);
      }
    });
  }

  // Idempotent: stopping when nothing runs is a no-op.
  stop(sessionId: string): void {
    this.running.get(sessionId)?.stop('user');
  }
}
