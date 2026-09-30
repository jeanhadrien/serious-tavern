import { canConnect } from '@st/shared/ports';
import type { Edge, PortDef, Workflow } from '@st/shared';
import { registry } from './registry.js';
import type { NodeDefinition, NodeResources } from './types.js';

export type PreparedWorkflow = {
  workflow: Workflow;
  resources: NodeResources;
  definitions: Map<string, NodeDefinition>;
  ports: Map<string, { inputs: PortDef[]; outputs: PortDef[] }>;
  incoming: Map<string, Edge[]>;
  upstream: Map<string, string[]>;
  reachable: Set<string>;
};

function cachedGet<T>(get: (id: string) => Promise<T | undefined>) {
  const cache = new Map<string, Promise<T | undefined>>();
  return (id: string) => {
    let pending = cache.get(id);
    if (!pending) {
      pending = Promise.resolve()
        .then(() => get(id))
        .then((value) => structuredClone(value));
      cache.set(id, pending);
    }
    return pending;
  };
}

export async function prepareWorkflow(
  source: Workflow,
  sourceResources: NodeResources = { presets: { get: async () => undefined } },
): Promise<{ errors: string[]; prepared?: undefined } | { errors: []; prepared: PreparedWorkflow }> {
  const workflow = structuredClone(source);
  const resources: NodeResources = {
    presets: { get: cachedGet((id) => sourceResources.presets.get(id)) },
    characters: { get: cachedGet(async (id) => sourceResources.characters?.get(id)) },
  };
  const errors: string[] = [];
  const ids = new Set<string>();
  const definitions = new Map<string, NodeDefinition>();
  const ports: PreparedWorkflow['ports'] = new Map();
  for (const node of workflow.nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
    const definition = registry.get(node.type);
    if (!definition) {
      errors.push(`Node ${node.id}: unknown type ${node.type}`);
      continue;
    }
    definitions.set(node.id, definition);
    const parsed = definition.configSchema.safeParse(node.config);
    if (parsed.success) node.config = parsed.data;
    else
      errors.push(
        `Node ${node.id}: invalid config: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
      );
    try {
      ports.set(
        node.id,
        definition.resolvePorts
          ? await definition.resolvePorts(node.config, resources)
          : { inputs: definition.inputs, outputs: definition.outputs },
      );
    } catch (error) {
      errors.push(`Node ${node.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (workflow.nodes.filter((n) => n.type === 'chat-input').length !== 1)
    errors.push('Expected exactly one chat-input node');
  if (!workflow.nodes.some((n) => n.type === 'chat-output')) errors.push('Expected at least one chat-output node');
  const edgeIds = new Set<string>();
  const inbound = new Map<string, number>(workflow.nodes.map((n) => [n.id, 0]));
  const adjacency = new Map<string, string[]>(workflow.nodes.map((n) => [n.id, []]));
  const incoming = new Map<string, Edge[]>(workflow.nodes.map((n) => [n.id, []]));
  const upstream = new Map<string, string[]>(workflow.nodes.map((n) => [n.id, []]));
  for (const edge of workflow.edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    const source = workflow.nodes.find((n) => n.id === edge.source);
    const target = workflow.nodes.find((n) => n.id === edge.target);
    if (!source || !target) {
      errors.push(`Edge ${edge.id}: missing source or target node`);
      continue;
    }
    incoming.get(edge.target)!.push(edge);
    upstream.get(edge.target)!.push(edge.source);
    const sourcePort = ports.get(source.id)?.outputs.find((p) => p.name === edge.sourceHandle);
    const targetPort = ports.get(target.id)?.inputs.find((p) => p.name === edge.targetHandle);
    if (!sourcePort) errors.push(`Edge ${edge.id}: invalid output port ${edge.sourceHandle}`);
    if (!targetPort) errors.push(`Edge ${edge.id}: invalid input port ${edge.targetHandle}`);
    if (sourcePort && targetPort) {
      const compatibility = canConnect(sourcePort, targetPort);
      if (!compatibility.ok)
        errors.push(
          `Edge ${edge.id}: ${source.id} (${source.type}).${sourcePort.name} [${sourcePort.dataType}] → ` +
            `${target.id} (${target.type}).${targetPort.name} [${targetPort.dataType}]: ${compatibility.reason}`,
        );
    }
    if (workflow.edges.some((e) => e !== edge && e.target === edge.target && e.targetHandle === edge.targetHandle))
      errors.push(`Edge ${edge.id}: input ${target.id}.${edge.targetHandle} has multiple connections`);
    inbound.set(edge.target, (inbound.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }
  for (const node of workflow.nodes) {
    for (const port of ports.get(node.id)?.inputs.filter((p) => p.required) ?? []) {
      if (!workflow.edges.some((e) => e.target === node.id && e.targetHandle === port.name))
        errors.push(`Node ${node.id}: required input ${port.name} is not connected`);
    }
    if (node.type === 'chat-input' && (inbound.get(node.id) ?? 0)) errors.push('Chat input cannot have incoming edges');
  }
  const degrees = new Map(inbound);
  const queue = [...degrees].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const next of adjacency.get(id) ?? []) {
      degrees.set(next, degrees.get(next)! - 1);
      if (degrees.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== workflow.nodes.length) errors.push('Workflow contains a cycle');
  if (errors.length) return { errors: [...new Set(errors)] };
  const reachable = new Set<string>();
  const visit = workflow.nodes.filter((node) => node.type === 'chat-output').map((node) => node.id);
  while (visit.length) {
    const id = visit.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    visit.push(...(upstream.get(id) ?? []));
  }
  return { errors: [], prepared: { workflow, resources, definitions, ports, incoming, upstream, reachable } };
}

export async function validateWorkflow(workflow: Workflow, resources?: NodeResources): Promise<string[]> {
  return (await prepareWorkflow(workflow, resources)).errors;
}
