import { createContext } from 'react';
import type { NodeRunStatus } from '../../stores/runActivity.js';

/**
 * What the canvas shows on its nodes that is not part of the draft: derived at render and provided here, never stored
 * in node `data` (the history copies `data`, so an undo would bring back stale marks).
 */
export interface CanvasOverlay {
  /** The messages of the engine's issues that name each node. */
  issuesByNode: ReadonlyMap<string, readonly string[]>;
  /** Where each node of the run streaming right now stands (only for the workflow that is running). */
  runStatus: Readonly<Record<string, NodeRunStatus>>;
}

export const CanvasOverlayContext = createContext<CanvasOverlay>({ issuesByNode: new Map(), runStatus: {} });
