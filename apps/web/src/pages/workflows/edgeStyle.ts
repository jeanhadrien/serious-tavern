import type { Edge } from '@xyflow/react';
import { checkConnection } from '../../connection.js';
import type { CanvasNode } from './model.js';

/**
 * The edges as drawn: incompatible ones red and labelled, converting ones dashed, the connections the engine's issues
 * name red, and the one a link asked to show (`focused`) thick and animated. Derived at render, never stored in the draft.
 */
export function styleEdges(
  edges: readonly Edge[],
  nodes: CanvasNode[],
  { focused, issues }: { focused?: string; issues: ReadonlySet<string> },
): Edge[] {
  return edges.map((edge) => {
    const result = checkConnection(edge, nodes);
    const isFocused = edge.id === focused;
    const hasIssue = issues.has(edge.id);
    return {
      ...edge,
      label: !result.ok ? 'incompatible' : result.coerce ? '→text' : undefined,
      labelStyle: { fill: isFocused || hasIssue || !result.ok ? '#ff8b93' : '#efcf9b', fontSize: 11 },
      // React Flow's label background is white by default, which hid the light label text on the dark canvas.
      labelBgStyle: { fill: '#21242c', fillOpacity: 0.95 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
      animated: isFocused || undefined,
      style:
        isFocused || hasIssue
          ? { stroke: '#ef8186', strokeWidth: 3 }
          : !result.ok
            ? { stroke: '#ef8186', strokeWidth: 2 }
            : result.coerce
              ? { stroke: '#e6bb77', strokeWidth: 2, strokeDasharray: '6 4' }
              : undefined,
    };
  });
}
