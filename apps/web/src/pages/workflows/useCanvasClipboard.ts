import { useRef, type Dispatch, type SetStateAction } from 'react';
import type { Edge } from '@xyflow/react';
import type { NodeTypeDescriptor } from '@st/shared';
import { alerts } from '../../alerts/index.js';
import { PASTE_OFFSET, parseClipboard, pasteNodes, serializeSelection } from './canvasClipboard.js';
import type { CanvasNode } from './model.js';

/**
 * Copy and paste of nodes through the native `copy` and `paste` events (handlers for `useShortcutArea`, which only
 * calls them when the canvas has the keyboard and focus is not in a field). Each returns true when it acted, which
 * is what makes the keyboard module call `preventDefault()`: a copy with nothing selected and a paste of ordinary
 * text go on as usual. A paste is one undo step (`record` once, then both lists change).
 */
export function useCanvasClipboard({
  nodes,
  edges,
  types,
  setNodes,
  setEdges,
  setSelected,
  record,
}: {
  nodes: CanvasNode[];
  edges: Edge[];
  types: NodeTypeDescriptor[];
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setSelected: (id: string | undefined) => void;
  record: () => void;
}) {
  // Consecutive pastes of the same text move further each time; a new copy starts over.
  const pasted = useRef<{ text: string; count: number }>(undefined);
  const copy = (event: ClipboardEvent): boolean => {
    if (!event.clipboardData || !nodes.some((node) => node.selected)) return false;
    event.clipboardData.setData('text/plain', serializeSelection(nodes, edges));
    pasted.current = undefined;
    return true;
  };
  const paste = (event: ClipboardEvent): boolean => {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const payload = parseClipboard(text);
    if (!payload) return false;
    const count = pasted.current?.text === text ? pasted.current.count + 1 : 1;
    pasted.current = { text, count };
    const result = pasteNodes(payload, { types, existing: nodes, offset: PASTE_OFFSET * count });
    for (const message of result.skipped) alerts.info(message);
    if (result.nodes.length === 0) return true;
    record();
    setSelected(undefined);
    setNodes((prev) => [...prev.map((node) => (node.selected ? { ...node, selected: false } : node)), ...result.nodes]);
    setEdges((prev) => [...prev.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)), ...result.edges]);
    return true;
  };
  return { copy, paste };
}
