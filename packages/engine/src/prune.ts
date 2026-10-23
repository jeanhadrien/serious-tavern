import type { Edge, NodeInstance, PortDef } from '@st/shared';
import { registry } from './registry.js';
import type { NodeResources } from './types.js';

type ResolvedPorts = { inputs: PortDef[]; outputs: PortDef[] };
// What pruning reads: positions and the rest of the record play no part, so a draft without positions qualifies.
type Graph = { nodes: Pick<NodeInstance, 'id' | 'type' | 'config'>[]; edges: Edge[] };

/**
 * Removes connections whose handle no longer exists on a node, e.g. an edge into
 * a preset input that the user deleted. Ports are only trusted when they resolve:
 * nodes with unknown types or failing resolvers keep every edge, because their
 * handles can't be verified. Returns a new workflow; the input is not mutated.
 */
export async function pruneInvalidEdges<W extends Graph>(workflow: W, resources: NodeResources): Promise<W> {
  const resolved = new Map<string, ResolvedPorts | undefined>();
  for (const node of workflow.nodes) {
    const definition = registry.get(node.type);
    if (!definition) {
      resolved.set(node.id, undefined);
      continue;
    }
    try {
      resolved.set(
        node.id,
        definition.resolvePorts
          ? await definition.resolvePorts(node.config, resources)
          : { inputs: definition.inputs, outputs: definition.outputs },
      );
    } catch {
      resolved.set(node.id, undefined);
    }
  }
  const edges = workflow.edges.filter((edge) => {
    const source = resolved.get(edge.source);
    if (source && !source.outputs.some((port) => port.name === edge.sourceHandle)) return false;
    const target = resolved.get(edge.target);
    if (target && !target.inputs.some((port) => port.name === edge.targetHandle)) return false;
    return true;
  });
  return { ...workflow, edges };
}
