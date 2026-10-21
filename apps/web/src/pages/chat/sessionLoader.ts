import type { ChangeEvent } from '@st/shared';

export type SessionLoad<T> = { value: T } | { failed: true };

export interface SessionLoaderDeps<T> {
  fetch(sessionId: string): Promise<T>;
  subscribe(listener: (event: ChangeEvent) => void): () => void;
  /** Other change events (not tied to a chat) that reload it, each with how long to wait (at least `delayMs`). */
  alsoOn?: Partial<Record<ChangeEvent['type'], number>>;
  /** How long changes are gathered into one fetch. */
  delayMs?: number;
}

const RELOAD_DELAY_MS = 100;

/**
 * Keeps one chat's server-computed view fresh: loads it at once, and again after this chat's `sessions.changed`
 * (which a settled turn, an edit and a delete all announce) and the `alsoOn` events. Changes arriving close
 * together become one fetch, and one arriving during a fetch makes exactly one more fetch after it (the first
 * answer may predate it, so it is not delivered). Nothing is ever fetched for streamed tokens: they emit no event.
 * After `stop()` nothing is fetched or delivered. The story state and the message statistics both load this way.
 */
export function startSessionLoader<T>(
  sessionId: string,
  { fetch, subscribe, alsoOn = {}, delayMs = RELOAD_DELAY_MS }: SessionLoaderDeps<T>,
  onResult: (result: SessionLoad<T>) => void,
): { reload(): void; stop(): void } {
  let stopped = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    running = true;
    let result: SessionLoad<T>;
    try {
      result = { value: await fetch(sessionId) };
    } catch {
      result = { failed: true };
    }
    running = false;
    if (stopped) return;
    if (again) {
      again = false;
      schedule();
      return;
    }
    onResult(result);
  };
  function schedule(wait = delayMs) {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, wait);
  }

  const unsubscribe = subscribe((event) => {
    const wait = alsoOn[event.type];
    if (wait !== undefined) schedule(Math.max(delayMs, wait));
    else if (event.type === 'sessions.changed' && (event.id === undefined || event.id === sessionId)) schedule();
  });
  void run();
  return {
    reload: () => schedule(),
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      unsubscribe();
    },
  };
}
