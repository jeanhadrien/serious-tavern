import { useCallback, useState, type RefObject } from 'react';
import { useReactFlow, type Connection, type FinalConnectionState } from '@xyflow/react';
import type { NodeTypeDescriptor } from '@st/shared';
import { connectCandidates, type Candidate, type DragOrigin } from './connectCandidates.js';
import type { CanvasNode } from './model.js';

/** Roughly how far the new node's body reaches left of an input drag's drop point (nodes are at least 175px wide). */
const NODE_WIDTH = 180;

/** Where the picker opened on the canvas: a connection drag's end (and the handle it came from) or a quick add. */
export interface PickerState {
  /** Drop point relative to the canvas, and the canvas size (for clamping). */
  at: { x: number; y: number };
  bounds: { width: number; height: number };
  /** The drop point in flow coordinates, where the node is created. */
  flow: { x: number; y: number };
  /** The handle a dragged connection came from; absent for a quick add, which adds a node with no edge. */
  from?: DragOrigin & { nodeId: string; handle: string };
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
 * drops) and connects it (through `linkEdge`, the edge rules of a manual connection). `openAt` is the quick add: the
 * same picker at a screen point, listing every type, and `pick` then adds the node with no edge.
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
  const hasChatInput = nodes.some((node) => node.data.descriptor.type === 'chat-input');
  // Shows the picker at a screen point, for the connection that was dragged from `from` or, with none, for a quick add.
  const show = (screen: { x: number; y: number }, from?: PickerState['from']) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return false;
    setState({
      at: { x: screen.x - rect.left, y: screen.y - rect.top },
      bounds: { width: rect.width, height: rect.height },
      flow: screenToFlowPosition(screen),
      from,
      candidates: connectCandidates(from && { side: from.side, port: from.port }, types, { hasChatInput }),
    });
    return true;
  };
  const open = (event: MouseEvent | TouchEvent, end: FinalConnectionState): boolean => {
    const { fromHandle, toHandle, toNode } = end;
    const screen = eventPoint(event);
    if (!fromHandle || toHandle || toNode || !screen) return false;
    const descriptor = nodes.find((node) => node.id === fromHandle.nodeId)?.data.descriptor;
    const side = fromHandle.type;
    const port = (side === 'source' ? descriptor?.outputs : descriptor?.inputs)?.find(
      (item) => item.name === fromHandle.id,
    );
    if (!port) return false;
    return show(screen, { side, port, nodeId: fromHandle.nodeId, handle: port.name });
  };
  const openAt = (screen: { x: number; y: number }) => show(screen);
  const pick = (candidate: Candidate) => {
    if (!state) return;
    const { from, flow } = state;
    if (!from) {
      // A quick add: the node is centred on the point, with nothing to connect.
      addNode(candidate.descriptor, { x: flow.x - NODE_WIDTH / 2, y: flow.y - 20 });
      close();
      return;
    }
    // The new node sits to the right of an output drop and to the left of an input drop, level with the cursor.
    const id = addNode(candidate.descriptor, {
      x: from.side === 'source' ? flow.x : flow.x - NODE_WIDTH,
      y: flow.y - 20,
    });
    if (candidate.port)
      linkEdge(
        from.side === 'source'
          ? { source: from.nodeId, sourceHandle: from.handle, target: id, targetHandle: candidate.port.name }
          : { source: id, sourceHandle: candidate.port.name, target: from.nodeId, targetHandle: from.handle },
      );
    close();
  };
  return { picker: state, open, openAt, pick, close };
}
