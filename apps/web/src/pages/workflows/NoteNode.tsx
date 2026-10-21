import { createContext, useContext } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import type { NoteNode as NoteNodeType } from './canvasNotes.js';

/** What a note can do to the canvas: its text is the draft's, so editing it goes through the canvas (and its history). */
export const NoteActionsContext = createContext<{ setText(id: string, text: string): void }>({ setText: () => {} });

/**
 * A sticky note: a movable, resizable, editable piece of free text saved with the workflow. The textarea carries React
 * Flow's `nodrag` and `nowheel` classes, or a click would drag the note and the wheel would zoom instead of scrolling it.
 */
export function NoteNode({ id, data, selected }: NodeProps<NoteNodeType>) {
  const { setText } = useContext(NoteActionsContext);
  return (
    <div className={`note-node${selected ? ' selected' : ''}`}>
      <NodeResizer isVisible={selected} minWidth={140} minHeight={80} />
      <textarea
        className="nodrag nowheel"
        aria-label="Note"
        placeholder="Write a note…"
        value={data.text}
        onChange={(event) => setText(id, event.target.value)}
      />
    </div>
  );
}
