import dagre from '@dagrejs/dagre';

/** A node to lay out: its id and the size it occupies on the canvas. */
export interface TidyNode {
  id: string;
  width: number;
  height: number;
}

/** What a node is taken to measure before React Flow has measured it (a typical small node). */
export const FALLBACK_NODE_SIZE = { width: 220, height: 120 };

/**
 * Where every node goes in a left-to-right layout: ranks follow the edges, so inputs end up on the left and outputs
 * on the right. Returns top-left positions by node id. dagre ignores which port an edge uses, so wires may still
 * cross inside a rank; edges to nodes that aren't given are ignored.
 */
export function tidyLayout(
  nodes: readonly TidyNode[],
  edges: readonly { source: string; target: string }[],
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const { id, width, height } of nodes) graph.setNode(id, { width, height });
  for (const { source, target } of edges)
    if (graph.hasNode(source) && graph.hasNode(target)) graph.setEdge(source, target);
  dagre.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  for (const { id, width, height } of nodes) {
    // dagre answers with the node's centre.
    const { x, y } = graph.node(id);
    positions.set(id, { x: x - width / 2, y: y - height / 2 });
  }
  return positions;
}
