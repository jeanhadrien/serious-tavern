import { canConnect, type ConnectionResult } from '@st/shared/ports';
import type { NodeTypeDescriptor } from '@st/shared';

type NodeWithDescriptor = { id: string; data: { descriptor: NodeTypeDescriptor } };
export function checkConnection(
  connection: {
    source: string | null;
    sourceHandle?: string | null;
    target: string | null;
    targetHandle?: string | null;
  },
  nodes: NodeWithDescriptor[],
): ConnectionResult {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle)
    return { ok: false, reason: 'Connect a named output to a named input' };
  if (connection.source === connection.target) return { ok: false, reason: 'A node cannot connect to itself' };
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  const from = source?.data.descriptor.outputs.find((port) => port.name === connection.sourceHandle);
  const to = target?.data.descriptor.inputs.find((port) => port.name === connection.targetHandle);
  if (!from || !to) return { ok: false, reason: 'The selected source or target port does not exist' };
  return canConnect(from, to);
}
