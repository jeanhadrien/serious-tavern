import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunningTurn, TurnRegistry } from './turns.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
// Lets everything that is ready to run (microtasks and timers already due) run.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

afterEach(() => vi.restoreAllMocks());

describe('RunningTurn', () => {
  it('is stopped once: the first reason stays', () => {
    const turn = new RunningTurn();
    turn.stop('user');
    turn.stop('disconnect');
    expect(turn.stoppedBy).toBe('user');
    expect(turn.controller.signal.aborted).toBe(true);
    expect(turn.controller.signal.reason).toBe('user');
  });
});

describe('TurnRegistry follow-ups', () => {
  it('resolves with the turn’s result while the follow-up is still running', async () => {
    const registry = new TurnRegistry();
    const gate = deferred();
    const followed = vi.fn();
    const result = await registry.run('s', async (turn) => {
      turn.after = async () => {
        await gate.promise;
        followed();
      };
      return 'reply';
    });
    expect(result).toBe('reply');
    expect(followed).not.toHaveBeenCalled();
    gate.resolve();
    await registry.close();
    expect(followed).toHaveBeenCalledOnce();
  });

  it('keeps the slot until the follow-up ends: the next run on the same key waits, other keys do not', async () => {
    const registry = new TurnRegistry();
    const gate = deferred();
    await registry.run('s', async (turn) => {
      turn.after = () => gate.promise;
    });
    const started: string[] = [];
    const same = registry.run('s', async () => void started.push('same'));
    const other = registry.run('t', async () => void started.push('other'));
    await other;
    await settle();
    expect(started).toEqual(['other']);
    gate.resolve();
    await same;
    expect(started).toEqual(['other', 'same']);
  });

  it('makes a message queued before the follow-up existed wait for it as well', async () => {
    const registry = new TurnRegistry();
    const order: string[] = [];
    const hold = deferred();
    const gate = deferred();
    const first = registry.run('s', async (turn) => {
      order.push('first');
      await hold.promise;
      turn.after = async () => {
        order.push('follow-up starts');
        await gate.promise;
        order.push('follow-up ends');
      };
    });
    await settle();
    const second = registry.run('s', async () => {
      order.push('second');
    });
    hold.resolve();
    await first;
    await settle();
    expect(order).toEqual(['first', 'follow-up starts']);
    gate.resolve();
    await second;
    expect(order).toEqual(['first', 'follow-up starts', 'follow-up ends', 'second']);
  });

  it('hands the follow-up its own RunningTurn, which is what Stop stops', async () => {
    const registry = new TurnRegistry();
    const gate = deferred();
    let turn!: RunningTurn;
    let run!: RunningTurn;
    const seen = deferred();
    await registry.run('s', async (current) => {
      turn = current;
      current.after = async (next) => {
        run = next;
        seen.resolve();
        await gate.promise;
      };
    });
    await seen.promise;
    expect(run).not.toBe(turn);
    registry.stop('s');
    expect(run.stoppedBy).toBe('user');
    expect(run.controller.signal.aborted).toBe(true);
    expect(turn.stoppedBy).toBeUndefined();
    expect(turn.controller.signal.aborted).toBe(false);
    gate.resolve();
    await registry.close();
  });

  it('still stops the turn while it runs, and Stop with nothing running is a no-op', async () => {
    const registry = new TurnRegistry();
    expect(() => registry.stop('nothing')).not.toThrow();
    const entered = deferred();
    const gate = deferred();
    let turn!: RunningTurn;
    const done = registry.run('s', async (current) => {
      turn = current;
      entered.resolve();
      await gate.promise;
    });
    await entered.promise;
    registry.stop('s');
    expect(turn.stoppedBy).toBe('user');
    gate.resolve();
    await done;
    expect(() => registry.stop('s')).not.toThrow();
    expect(turn.stoppedBy).toBe('user');
  });

  it('does not let a follow-up that throws reject the caller or block the queue', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registry = new TurnRegistry();
    await expect(
      registry.run('s', async (turn) => {
        turn.after = async () => {
          throw new Error('follow-up exploded');
        };
        return 'reply';
      }),
    ).resolves.toBe('reply');
    await expect(registry.run('s', async () => 'next')).resolves.toBe('next');
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.at(-1))).toContain('follow-up exploded');
  });

  it('delivers an action’s rejection, runs no follow-up without one, and goes on', async () => {
    const registry = new TurnRegistry();
    await expect(
      registry.run('s', async () => {
        throw new Error('turn failed');
      }),
    ).rejects.toThrow('turn failed');
    await expect(registry.run('s', async () => 'next')).resolves.toBe('next');
  });

  it('still runs a follow-up the action registered before it failed', async () => {
    const registry = new TurnRegistry();
    const followed = vi.fn(async () => undefined);
    await expect(
      registry.run('s', async (turn) => {
        turn.after = followed;
        throw new Error('late failure');
      }),
    ).rejects.toThrow('late failure');
    await registry.close();
    expect(followed).toHaveBeenCalledOnce();
  });
});

describe('TurnRegistry.hasPostRun', () => {
  it('is true from the moment the id is set until the slot is released, for that id and session only', async () => {
    const registry = new TurnRegistry();
    const gate = deferred();
    const hold = deferred();
    const entered = deferred();
    const seen: Record<string, boolean> = {};
    const probe = (label: string) => {
      seen[label] = registry.hasPostRun('s', 'p1');
    };
    const done = registry.run('s', async (turn) => {
      probe('before it is set');
      turn.postExecutionId = 'p1';
      probe('set, still in the turn');
      entered.resolve();
      await hold.promise;
      turn.after = async (run) => {
        expect(run.postExecutionId).toBe('p1');
        probe('in the follow-up');
        await gate.promise;
      };
    });
    await entered.promise;
    expect(registry.hasPostRun('s', 'p2')).toBe(false);
    expect(registry.hasPostRun('t', 'p1')).toBe(false);
    hold.resolve();
    await done;
    await settle();
    expect(registry.hasPostRun('s', 'p1')).toBe(true);
    gate.resolve();
    await registry.close();
    expect(registry.hasPostRun('s', 'p1')).toBe(false);
    expect(seen).toEqual({
      'before it is set': false,
      'set, still in the turn': true,
      'in the follow-up': true,
    });
  });

  it('is false for a turn that never had a post run', async () => {
    const registry = new TurnRegistry();
    const entered = deferred();
    const gate = deferred();
    const done = registry.run('s', async () => {
      entered.resolve();
      await gate.promise;
    });
    await entered.promise;
    expect(registry.hasPostRun('s', 'p1')).toBe(false);
    gate.resolve();
    await done;
  });
});

describe('TurnRegistry.close', () => {
  it('resolves at once when nothing runs', async () => {
    await expect(new TurnRegistry().close()).resolves.toBeUndefined();
  });

  it('stops a running follow-up with "shutdown" and waits for it to end', async () => {
    const registry = new TurnRegistry();
    const entered = deferred();
    let ended = false;
    let run!: RunningTurn;
    await registry.run('s', async (turn) => {
      turn.after = async (next) => {
        run = next;
        entered.resolve();
        await new Promise<void>((resolve) => next.controller.signal.addEventListener('abort', () => resolve()));
        await settle();
        ended = true;
      };
    });
    await entered.promise;
    await registry.close();
    expect(run.stoppedBy).toBe('shutdown');
    expect(ended).toBe(true);
  });

  it('keeps the first reason when the job was already stopped', async () => {
    const registry = new TurnRegistry();
    const entered = deferred();
    let run!: RunningTurn;
    await registry.run('s', async (turn) => {
      turn.after = async (next) => {
        run = next;
        entered.resolve();
        await new Promise<void>((resolve) => next.controller.signal.addEventListener('abort', () => resolve()));
      };
    });
    await entered.promise;
    registry.stop('s');
    await registry.close();
    expect(run.stoppedBy).toBe('user');
  });

  it('stops a queued job that starts while it shuts down, from its first instant, and waits for it', async () => {
    const registry = new TurnRegistry();
    const entered = deferred();
    let followUp!: RunningTurn;
    await registry.run('s', async (turn) => {
      turn.after = async (next) => {
        followUp = next;
        entered.resolve();
        await new Promise<void>((resolve) => next.controller.signal.addEventListener('abort', () => resolve()));
      };
    });
    await entered.promise;
    let queued: { stoppedBy?: string; abortedAtStart: boolean } | undefined;
    let finished = false;
    const second = registry.run('s', async (turn) => {
      queued = { stoppedBy: turn.stoppedBy, abortedAtStart: turn.controller.signal.aborted };
      await settle();
      finished = true;
    });
    await registry.close();
    await second;
    expect(followUp.stoppedBy).toBe('shutdown');
    expect(queued).toEqual({ stoppedBy: 'shutdown', abortedAtStart: true });
    expect(finished).toBe(true);
  });
});
