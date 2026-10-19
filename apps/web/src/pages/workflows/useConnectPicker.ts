import { useCallback, useState, type RefObject } from 'react';
import { useReactFlow, type Connection, type FinalConnectionState } from '@xyflow/react';
import type { NodeTypeDescriptor } from '@st/shared';
import { connectCandidates, type Candidate, type DragOrigin } from './connectCandidates.js';
import type { CanvasNode } from './model.js';

/** Roughly how far the new node's body reaches left of an input drag's drop point (nodes are at least 175px wide). */
const NODE_WIDTH = 180;

/** Where a connection drag ended on empty canvas, and the handle it came from. */
export interface PickerState {
  /** Drop point relative to the canvas, and the canvas size (for clamping). */
  at: { x: number; y: number };
  bounds: { width: number; height: number };
  /** The drop point in flow coordinates, where the node is created. */
  flow: { x: number; y: number };
  from: DragOrigin & { nodeId: string; handle: string };
  candidates: Candidate[];
}

/** The drop point of a mouse or touch event (a touch that ended has no `touches`, only `changedTouches`). */
function eventPoint(event: MouseEvent | TouchEvent): { x: number; y: number } | undefined {
  const point = 'changedTouches' in event ? event.changedTouches[0] : event;
  return point ? { x: point.clientX, y: point.clientY } : undefined;
}

/**
 * The node picker that opens when a connection is dropped on empty canvas. `open` is fed `onConnectEnd`'s arguments
 * and says whether it took the drop; `pick` creates the chosen node there (through the same `addNode` as palette
 * drops) and connects it (through `linkEdge`, the edge rules of a manual connection).
 */
export function useConnectPicker({
  nodes,
  types,
  canvasRef,
  addNode,
  linkEdge,
}: {
  nodes: CanvasNode[];
  types: NodeTypeDescriptor[];
  canvasRef: RefObject<HTMLDivElement | null>;
  addNode: (descriptor: NodeTypeDescriptor, position: { x: number; y: number }) => string;
  linkEdge: (connection: Connection) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const [state, setState] = useState<PickerState>();
  const close = useCallback(() => setState(undefined), []);
  const open = (event: MouseEvent | TouchEvent, end: FinalConnectionState): boolean => {
    const { fromHandle, toHandle, toNode } = end;
    const rect = canvasRef.current?.getBoundingClientRect();
    const screen = eventPoint(event);
    if (!fromHandle || toHandle || toNode || !rect || !screen) return false;
    const descriptor = nodes.find((node) => node.id === fromHandle.nodeId)?.data.descriptor;
    const side = fromHandle.type;
    const port = (side === 'source' ? descriptor?.outputs : descriptor?.inputs)?.find(
      (item) => item.name === fromHandle.id,
    );
    if (!port) return false;
    const origin: DragOrigin = { side, port };
    const hasChatInput = nodes.some((node) => node.data.descriptor.type === 'chat-input');
    setState({
      at: { x: screen.x - rect.left, y: screen.y - rect.top },
      bounds: { width: rect.width, height: rect.height },
      flow: screenToFlowPosition(screen),
      from: { ...origin, nodeId: fromHandle.nodeId, handle: port.name },
      candidates: connectCandidates(origin, types, { hasChatInput }),
    });
    return true;
  };
  const pick = (candidate: Candidate) => {
    if (!state) return;
    const { from, flow } = state;
    // The new node sits to the right of an output drop and to the left of an input drop, level with the cursor.
    const id = addNode(candidate.descriptor, {
      x: from.side === 'source' ? flow.x : flow.x - NODE_WIDTH,
      y: flow.y - 20,
    });
    linkEdge(
      from.side === 'source'
        ? { source: from.nodeId, sourceHandle: from.handle, target: id, targetHandle: candidate.port.name }
        : { source: id, sourceHandle: candidate.port.name, target: from.nodeId, targetHandle: from.handle },
    );
    close();
  };
  return { picker: state, open, pick, close };
}
