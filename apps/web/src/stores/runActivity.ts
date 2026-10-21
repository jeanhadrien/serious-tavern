import { useSyncExternalStore } from 'react';
import type { ExecutionLog } from '@st/shared';

/** Where a node of the streaming run stands. The same words as an execution log's node status. */
export type NodeRunStatus = ExecutionLog['nodes'][string]['status'];

export interface RunActivity {
  /** The workflow whose run is streaming (or just did); nothing when no run is. */
  workflowId?: string;
  /** Status by node id, for that run only. */
  nodes: Readonly<Record<string, NodeRunStatus>>;
}

/** How long the marks of a finished turn stay, so the outcome can be seen before they clear. */
export const LINGER_MS = 3000;

const idle: RunActivity = { nodes: {} };
let state = idle;
let clearTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const set = (next: RunActivity) => {
  state = next;
  for (const listener of [...listeners]) listener();
};

/**
 * What the open chat's streaming turn is doing, for the workflow editor to show. The chat writes it, one run at a time
 * (a run's nodes replace the previous run's); it holds nothing of the session. Only the tab that sent the message has it.
 */
export const runActivity = {
  getSnapshot: (): RunActivity => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** A run of the reply list begins: the previous run's marks go. */
  startRun(workflowId: string) {
    clearTimeout(clearTimer);
    set({ workflowId, nodes: {} });
  },
  setNode(nodeId: string, status: NodeRunStatus) {
    if (state.workflowId === undefined) return;
    set({ ...state, nodes: { ...state.nodes, [nodeId]: status } });
  },
  /** The turn ended (completed, failed or stopped): the marks stay for `LINGER_MS`, then clear. */
  finish() {
    clearTimeout(clearTimer);
    if (state.workflowId !== undefined) clearTimer = setTimeout(runActivity.clear, LINGER_MS);
  },
  clear() {
    clearTimeout(clearTimer);
    if (state !== idle) set(idle);
  },
};

export const useRunActivity = (): RunActivity => useSyncExternalStore(runActivity.subscribe, runActivity.getSnapshot);
