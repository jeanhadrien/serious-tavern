import type { Node, NodeChange } from '@xyflow/react';
import type { Note } from '@st/shared';

/**
 * A sticky note as React Flow holds it. Notes are kept apart from the workflow's nodes (their own state, merged into the
 * `nodes` prop only when the canvas renders), so every reader of `CanvasNode`s stays free of them. `extra` keeps the
 * fields of a note this version doesn't know, so a save never drops them. A note has a `width` and `height` only once it
 * was resized or loaded with a size.
 */
export type NoteNode = Node<{ text: string; extra?: Record<string, unknown> }, 'note'>;

/** The stored notes as canvas nodes. */
export const noteNodesOf = (notes: readonly Note[]): NoteNode[] =>
  notes.map(({ id, text, position, size, ...extra }) => ({
    id,
    type: 'note',
    position,
    data: { text, ...(Object.keys(extra).length ? { extra } : {}) },
    ...(size && { width: size.width, height: size.height }),
  }));

/** The canvas notes as stored: text, position and, when it has one, size. Selection and measurements are the view's. */
export const notesOf = (nodes: readonly NoteNode[]): Note[] =>
  nodes.map((node) => ({
    ...node.data.extra,
    id: node.id,
    text: node.data.text,
    position: node.position,
    ...(node.width !== undefined && node.height !== undefined && { size: { width: node.width, height: node.height } }),
  }));

export const newNoteNode = (id: string, position: { x: number; y: number }): NoteNode => ({
  id,
  type: 'note',
  position,
  data: { text: '' },
});

/**
 * Splits the changes React Flow reports for the merged node list: those about a note (by id) and the rest, which are the
 * workflow nodes'. A change without an id (an `add` or `reset`) is never a note's.
 */
export function partitionChanges<T extends NodeChange>(
  changes: readonly T[],
  noteIds: ReadonlySet<string>,
): { forNotes: T[]; rest: T[] } {
  const forNotes: T[] = [];
  const rest: T[] = [];
  for (const change of changes) ('id' in change && noteIds.has(change.id) ? forNotes : rest).push(change);
  return { forNotes, rest };
}

/**
 * Whether a note change starts a resize, which is one history step: the first dimensions change with resizing true
 * after one that wasn't (a resize sends many, and ends with resizing false). `wasResizing` is the state before it.
 */
export const startsResize = (change: NodeChange, wasResizing: boolean): boolean =>
  change.type === 'dimensions' && change.resizing === true && !wasResizing;
