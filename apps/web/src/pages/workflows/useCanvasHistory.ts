import { useCallback, useReducer, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Edge } from '@xyflow/react';
import type { NoteNode } from './canvasNotes.js';
import type { CanvasNode } from './model.js';
import {
  emptyHistory,
  nodesMoved,
  record as recordStep,
  redo,
  restoreNodes,
  snapshotOf,
  undo,
  type CanvasSnapshot,
  type History,
} from './canvasHistory.js';

/**
 * Undo/redo for the canvas draft (pure rules in `canvasHistory.ts`). The canvas calls `record()` right before it
 * changes nodes, edges or notes; `load`/`clear` call `reset()`. Edges pruned by `useDynamicPorts` are not steps: it uses the
 * raw setters, so undo brings them back together with the config that made them go.
 *
 * `record(before?, groupKey?)` is also the way to record a step the canvas hook doesn't know about (a paste): call it
 * once before applying the change. Without `before` it takes the current canvas.
 */
export function useCanvasHistory({
  nodes,
  edges,
  notes,
  setNodes,
  setEdges,
  setNotes,
  onRestore,
}: {
  nodes: CanvasNode[];
  edges: Edge[];
  notes: NoteNode[];
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNotes: Dispatch<SetStateAction<NoteNode[]>>;
  /** Called with the state that was put back, e.g. to close a config panel whose node is gone. */
  onRestore: (snapshot: CanvasSnapshot) => void;
}) {
  // A new object for each render: the canvas as the handlers see it.
  const latest = useRef({ nodes, edges, notes });
  latest.current = { nodes, edges, notes };
  const history = useRef<History>(emptyHistory);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const commit = useCallback((next: History) => {
    history.current = next;
    rerender();
  }, []);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // One user action can change nodes and edges in the same tick (deleting a node takes its edges, a picked node
  // arrives with its edge). Only the first call records; it holds the state before both.
  const inTick = useRef(false);
  const record = useCallback(
    (before?: CanvasSnapshot, groupKey?: string) => {
      if (!before) {
        if (inTick.current) return;
        inTick.current = true;
        queueMicrotask(() => {
          inTick.current = false;
        });
      }
      const start = before ?? snapshotOf(latest.current.nodes, latest.current.edges, latest.current.notes);
      commit(recordStep(history.current, start, groupKey));
    },
    [commit],
  );

  const step = (move: typeof undo): boolean => {
    const current = snapshotOf(latest.current.nodes, latest.current.edges, latest.current.notes);
    const result = move(history.current, current);
    if (!result.snapshot) return false;
    commit(result.history);
    // Everything comes back unselected (the snapshot has no selection).
    setNodes(restoreNodes(result.snapshot.nodes, latest.current.nodes));
    setEdges(result.snapshot.edges);
    setNotes(restoreNodes(result.snapshot.notes, latest.current.notes));
    onRestoreRef.current(result.snapshot);
    return true;
  };

  // A drag is one step: the canvas before it is kept, and recorded when it ends only if a node actually moved.
  const dragStart = useRef<CanvasSnapshot>(undefined);
  const onDragStart = useCallback(() => {
    dragStart.current = snapshotOf(latest.current.nodes, latest.current.edges, latest.current.notes);
  }, []);
  const onDragStop = useCallback(
    (dragged: readonly { id: string; position: { x: number; y: number } }[]) => {
      const start = dragStart.current;
      dragStart.current = undefined;
      if (start && nodesMoved(start, dragged)) record(start);
    },
    [record],
  );

  const reset = useCallback(() => {
    dragStart.current = undefined;
    commit(emptyHistory);
  }, [commit]);

  return {
    record,
    undo: () => step(undo),
    redo: () => step(redo),
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
    reset,
    onDragStart,
    onDragStop,
  };
}
