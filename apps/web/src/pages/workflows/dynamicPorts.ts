import type { Edge } from '@xyflow/react';
import type { ApiResponse, NodeInstance } from '@st/shared';
import type { CanvasNode } from './model.js';

type Ports = ApiResponse<'resolvePorts'>;
type PortRequest = { id: string; type: string; config: NodeInstance['config'] };

export function portRequests(nodes: CanvasNode[]): PortRequest[] {
  return nodes
    .filter((node) => !node.data.unknown && node.data.descriptor.dynamicPorts)
    .map((node) => ({ id: node.id, type: node.data.descriptor.type, config: node.data.config }));
}

export function portsEqual(left: Ports, right: Ports): boolean {
  return (
    JSON.stringify(left.inputs) === JSON.stringify(right.inputs) &&
    JSON.stringify(left.outputs) === JSON.stringify(right.outputs)
  );
}

/**
 * Applies a resolved port set to the matching node and prunes any of its edges
 * whose handle is no longer declared. Stale results (changed config/type,
 * unknown placeholders, missing nodes) are ignored and leave edges untouched.
 */
export function applyResolvedPorts(
  nodes: CanvasNode[],
  edges: Edge[],
  request: PortRequest,
  ports: Ports,
): { nodes: CanvasNode[]; edges: Edge[] } {
  const target = nodes.find((node) => node.id === request.id);
  if (
    !target ||
    target.data.unknown ||
    !target.data.descriptor.dynamicPorts ||
    target.data.descriptor.type !== request.type ||
    JSON.stringify(target.data.config) !== JSON.stringify(request.config)
  )
    return { nodes, edges };
  const nextNodes = portsEqual(target.data.descriptor, ports)
    ? nodes
    : nodes.map((node) =>
        node.id === request.id
          ? { ...node, data: { ...node.data, descriptor: { ...node.data.descriptor, ...ports } } }
          : node,
      );
  const inputNames = new Set(ports.inputs.map((port) => port.name));
  const outputNames = new Set(ports.outputs.map((port) => port.name));
  const nextEdges = edges.filter((edge) => {
    if (edge.source === request.id && !outputNames.has(edge.sourceHandle ?? '')) return false;
    if (edge.target === request.id && !inputNames.has(edge.targetHandle ?? '')) return false;
    return true;
  });
  return { nodes: nextNodes, edges: nextEdges };
}

export async function resolvePortRequests(
  requests: PortRequest[],
  resolve: (request: PortRequest) => Promise<Ports | undefined>,
  accept: (request: PortRequest, ports: Ports) => void,
  isCurrent: () => boolean,
): Promise<void> {
  await Promise.all(
    requests.map(async (request) => {
      const ports = await resolve(request);
      if (ports && isCurrent()) accept(request, ports);
    }),
  );
}
