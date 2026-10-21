import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { applyNodeChanges, type NodeChange } from '@xyflow/react';
import { newNoteNode, partitionChanges, startsResize, type NoteNode } from './canvasNotes.js';
import type { CanvasNode } from './model.js';

/**
 * The sticky notes of the canvas: their own state beside the nodes, merged into React Flow's `nodes` only when the canvas
 * renders. `record` is the history's (called right before a change, as for nodes). `apply` takes the node changes React
 * Flow reports, applies the ones that are about a note and hands back the rest for the nodes.
 */
export function useCanvasNotes({
  notes,
  setNotes,
  record,
}: {
  notes: NoteNode[];
  setNotes: Dispatch<SetStateAction<NoteNode[]>>;
  record: (before?: undefined, groupKey?: string) => void;
}) {
  const ids = useRef(new Set<string>());
  ids.current = new Set(notes.map((note) => note.id));
  // A resize sends many changes; the first one is the step (the canvas before it), the last has `resizing: false`.
  const resizing = useRef(false);

  const apply = useCallback(
    (changes: NodeChange<CanvasNode | NoteNode>[]): NodeChange<CanvasNode>[] => {
      const { forNotes, rest } = partitionChanges(changes, ids.current);
      if (forNotes.length) {
        if (forNotes.some((change) => change.type === 'remove')) record();
        for (const change of forNotes) {
          if (change.type !== 'dimensions' || change.resizing === undefined) continue;
          if (startsResize(change, resizing.current)) record();
          resizing.current = change.resizing;
        }
        setNotes((prev) => applyNodeChanges(forNotes as NodeChange<NoteNode>[], prev));
      }
      return rest as NodeChange<CanvasNode>[];
    },
    [record, setNotes],
  );

  /** Adds an empty note at a flow position. Returns its id. */
  const addNote = (position: { x: number; y: number }): string => {
    const id = crypto.randomUUID();
    record();
    setNotes((prev) => [...prev, newNoteNode(id, position)]);
    return id;
  };

  /** Typing in one note is a single step while the pauses stay short, like a config field. */
  const setText = useCallback(
    (id: string, text: string) => {
      record(undefined, `note:${id}`);
      setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, data: { ...note.data, text } } : note)));
    },
    [record, setNotes],
  );

  return { apply, addNote, setText };
}
