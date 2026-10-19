import type { Edge } from '@xyflow/react';
import type { CanvasNode } from './model.js';

/** The part of the canvas that undo restores: what the draft holds, without selection or React Flow's bookkeeping. */
export interface CanvasSnapshot {
  nodes: CanvasNode[];
  edges: Edge[];
}

export interface History {
  /** States to go back to, oldest first. */
  past: CanvasSnapshot[];
  /** States undone, newest undo last. Any new step clears it. */
  future: CanvasSnapshot[];
  /** The last grouped step: more changes with the same key soon after it belong to that step. */
  group?: { key: string; at: number };
}

export const HISTORY_LIMIT = 100;
/** Typing into one field is one step as long as the pauses between changes stay below this. */
export const GROUP_WINDOW_MS = 1000;

export const emptyHistory: History = { past: [], future: [] };

/**
 * A snapshot of nodes and edges. Selection, `dragging`, `resizing` and React Flow's measurements belong to the view,
 * not to the draft, so they are left out: undoing never brings back an old selection or a stale size. The rest is
 * shared with the live state, which is never mutated.
 */
export function snapshotOf(nodes: CanvasNode[], edges: Edge[]): CanvasSnapshot {
  return {
    nodes: nodes.map((node) => {
      const { selected, dragging, resizing, measured, width, height, ...rest } = node;
      return rest;
    }),
    edges: edges.map((edge) => {
      const { selected, ...rest } = edge;
      return rest;
    }),
  };
}

const capped = (list: CanvasSnapshot[]) => (list.length > HISTORY_LIMIT ? list.slice(-HISTORY_LIMIT) : list);

/**
 * Records a step: `before` is the state the change started from. It clears the redo list. A `groupKey` equal to the
 * previous step's within `GROUP_WINDOW_MS` adds nothing (the change joins that step) and keeps the window open.
 */
export function record(history: History, before: CanvasSnapshot, groupKey?: string, now = Date.now()): History {
  if (groupKey !== undefined && history.group?.key === groupKey && now - history.group.at <= GROUP_WINDOW_MS) {
    return { ...history, group: { key: groupKey, at: now } };
  }
  return {
    past: capped([...history.past, before]),
    future: [],
    group: groupKey === undefined ? undefined : { key: groupKey, at: now },
  };
}

/** Goes back one step; `current` is kept for redo. Nothing to undo gives no snapshot. */
export function undo(history: History, current: CanvasSnapshot): { history: History; snapshot?: CanvasSnapshot } {
  const snapshot = history.past.at(-1);
  if (!snapshot) return { history };
  return { history: { past: history.past.slice(0, -1), future: [...history.future, current] }, snapshot };
}

/** Goes forward again after an undo; `current` goes back on the undo list. */
export function redo(history: History, current: CanvasSnapshot): { history: History; snapshot?: CanvasSnapshot } {
  const snapshot = history.future.at(-1);
  if (!snapshot) return { history };
  return {
    history: { past: capped([...history.past, current]), future: history.future.slice(0, -1) },
    snapshot,
  };
}

/** Whether any of the dragged nodes ended somewhere else than where the snapshot had it. */
export function nodesMoved(
  start: CanvasSnapshot,
  dragged: readonly { id: string; position: { x: number; y: number } }[],
) {
  return dragged.some((node) => {
    const before = start.nodes.find((item) => item.id === node.id)?.position;
    return before !== undefined && (before.x !== node.position.x || before.y !== node.position.y);
  });
}

/**
 * The nodes of a snapshot for the canvas. They keep the measurements of the live node with the same id, or React
 * Flow would hide them until it measured them again.
 */
export function restoreNodes(snapshot: CanvasNode[], live: CanvasNode[]): CanvasNode[] {
  const measured = new Map(live.map((node) => [node.id, node.measured]));
  return snapshot.map((node) => {
    const size = measured.get(node.id);
    return size ? { ...node, measured: size } : node;
  });
}
