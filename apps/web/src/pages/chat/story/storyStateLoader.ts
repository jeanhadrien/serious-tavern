import type { ChangeEvent, SessionStateView } from '@st/shared';

export type StoryLoad = { view: SessionStateView } | { failed: true };

export interface StoryLoaderDeps {
  fetch(sessionId: string): Promise<SessionStateView>;
  subscribe(listener: (event: ChangeEvent) => void): () => void;
  /** How long changes are gathered into one fetch. */
  delayMs?: number;
}

const STORY_RELOAD_DELAY_MS = 100;
// A saved definition is announced twice (by the API write and, a moment later, by the file watcher): wait for both.
const DEFINITION_RELOAD_DELAY_MS = 300;

/**
 * Keeps one chat's story state view fresh: loads it at once, and again after the changes that can alter it
 * (this chat's `sessions.changed`, which a settled turn, an edit and a delete all announce, and
 * `stateDefinitions.changed`). Changes arriving close together become one fetch (a definition change waits a
 * little longer, as the server announces it twice), and one arriving during a fetch
 * makes exactly one more fetch after it (the first answer may predate it, so it is not delivered). Nothing is
 * ever fetched for streamed tokens: they emit no event. After `stop()` nothing is fetched or delivered.
 */
export function startStoryLoader(
  sessionId: string,
  { fetch, subscribe, delayMs = STORY_RELOAD_DELAY_MS }: StoryLoaderDeps,
  onResult: (result: StoryLoad) => void,
): { reload(): void; stop(): void } {
  let stopped = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    running = true;
    let result: StoryLoad;
    try {
      result = { view: await fetch(sessionId) };
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
    if (event.type === 'stateDefinitions.changed') schedule(Math.max(delayMs, DEFINITION_RELOAD_DELAY_MS));
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
