import type { ChangeEvent, ReplyPlan } from '@st/shared';

export type ReplyPlanLoaderDeps = {
  fetch(sessionId: string): Promise<ReplyPlan>;
  subscribe(listener: (event: ChangeEvent) => void): () => void;
  /** How long changes are gathered into one fetch. */
  delayMs?: number;
};

const RELOAD_DELAY_MS = 200;

// What can change a plan without the chat's own list changing: the workflows it lists (their nodes and templates), the
// state definitions and presets those reference, and the cards whose fields are rendered. A chat's own turns never do.
const CHANGES_THE_PLAN = new Set<ChangeEvent['type']>([
  'workflows.changed',
  'stateDefinitions.changed',
  'presets.changed',
  'characters.changed',
  'personas.changed',
]);

/**
 * Keeps one chat's reply plan fresh: loads it at once and again after a change that can alter it. Changes arriving close
 * together become one fetch, and one arriving during a fetch makes exactly one more after it (the first answer may predate
 * it, so it is not delivered). A failed load is dropped: the list simply shows no hints. Nothing is fetched for streamed
 * tokens; after `stop()` nothing is fetched or delivered.
 */
export function startReplyPlanLoader(
  sessionId: string,
  { fetch, subscribe, delayMs = RELOAD_DELAY_MS }: ReplyPlanLoaderDeps,
  onResult: (plan: ReplyPlan | undefined) => void,
): { stop(): void } {
  let stopped = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    running = true;
    let plan: ReplyPlan | undefined;
    try {
      plan = await fetch(sessionId);
    } catch {
      plan = undefined;
    }
    running = false;
    if (stopped) return;
    if (again) {
      again = false;
      schedule();
      return;
    }
    onResult(plan);
  };
  function schedule() {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, delayMs);
  }

  const unsubscribe = subscribe((event) => {
    if (CHANGES_THE_PLAN.has(event.type)) schedule();
  });
  void run();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      unsubscribe();
    },
  };
}
