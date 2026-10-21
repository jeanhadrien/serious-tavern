import { useSyncExternalStore } from 'react';

/**
 * The execution id of the latest settled run of each workflow in the open chat, by workflow id. The chat publishes it
 * when its session settles; the workflow editor reads it to show a node's last run. It holds ids only: no session data.
 */
type ChatRuns = ReadonlyMap<string, string>;

let runs: ChatRuns = new Map();
const listeners = new Set<() => void>();

const same = (a: ChatRuns, b: ChatRuns) => a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);

export const chatRuns = {
  getSnapshot: (): ChatRuns => runs,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** Replaces the runs; a listener only hears of a change. */
  publish(next: ChatRuns) {
    if (same(runs, next)) return;
    runs = next;
    for (const listener of [...listeners]) listener();
  },
};

/** The latest settled run of the workflow in the open chat, if it has one. */
export function useChatRunOf(workflowId: string | undefined): string | undefined {
  const all = useSyncExternalStore(chatRuns.subscribe, chatRuns.getSnapshot);
  return workflowId === undefined ? undefined : all.get(workflowId);
}
