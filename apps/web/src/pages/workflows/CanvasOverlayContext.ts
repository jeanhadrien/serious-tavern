import { createContext } from 'react';

/**
 * What the canvas shows on its nodes that is not part of the draft: derived at render and provided here, never stored
 * in node `data` (the history copies `data`, so an undo would bring back stale marks).
 */
export interface CanvasOverlay {
  /** The messages of the engine's issues that name each node. */
  issuesByNode: ReadonlyMap<string, readonly string[]>;
}

export const CanvasOverlayContext = createContext<CanvasOverlay>({ issuesByNode: new Map() });
