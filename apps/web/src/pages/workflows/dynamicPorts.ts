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

export function applyResolvedPorts(nodes: CanvasNode[], request: PortRequest, ports: Ports): CanvasNode[] {
  return nodes.map((node) => {
    if (
      node.id !== request.id ||
      node.data.unknown ||
      !node.data.descriptor.dynamicPorts ||
      node.data.descriptor.type !== request.type ||
      JSON.stringify(node.data.config) !== JSON.stringify(request.config) ||
      portsEqual(node.data.descriptor, ports)
    )
      return node;
    return { ...node, data: { ...node.data, descriptor: { ...node.data.descriptor, ...ports } } };
  });
}

export async function resolvePortRequests(
  requests: PortRequest[],
  resolve: (request: PortRequest) => Promise<Ports>,
  accept: (request: PortRequest, ports: Ports) => void,
  isCurrent: () => boolean,
): Promise<void> {
  await Promise.all(
    requests.map(async (request) => {
      const ports = await resolve(request);
      if (isCurrent()) accept(request, ports);
    }),
  );
}
