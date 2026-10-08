import { nodeDisplayName } from '@st/shared';
import { canConnect } from '@st/shared/ports';
import type { Edge, PortDef, ValidationIssue, Workflow } from '@st/shared';
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

const labelOf = (type: string) => registry.get(type)?.label ?? type;

/** Lists port names for a validation message, or "none" when there are none. */
const availablePorts = (ports: ReadonlyArray<PortDef> | undefined) =>
  ports?.length ? ports.map((port) => port.name).join(', ') : 'none';

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
): Promise<{ errors: ValidationIssue[]; prepared?: undefined } | { errors: []; prepared: PreparedWorkflow }> {
  const workflow = structuredClone(source);
  const resources: NodeResources = {
    presets: { get: cachedGet((id) => sourceResources.presets.get(id)) },
    characters: { get: cachedGet(async (id) => sourceResources.characters?.get(id)) },
  };
  const errors: ValidationIssue[] = [];
  const nameOf = (id: string) => nodeDisplayName(workflow.nodes, labelOf, id);
  const ids = new Set<string>();
  const definitions = new Map<string, NodeDefinition>();
  const ports: PreparedWorkflow['ports'] = new Map();
  for (const node of workflow.nodes) {
    if (ids.has(node.id))
      errors.push({
        message: 'More than one node uses the same id; every node needs a unique id.',
        nodeIds: [node.id],
      });
    ids.add(node.id);
    const definition = registry.get(node.type);
    if (!definition) {
      errors.push({
        message: `"${nameOf(node.id)}" has an unknown node type; it can't run.`,
        nodeIds: [node.id],
      });
      continue;
    }
    definitions.set(node.id, definition);
    const parsed = definition.configSchema.safeParse(node.config);
    if (parsed.success) node.config = parsed.data;
    else
      errors.push({
        message: `"${nameOf(node.id)}" has an invalid config: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ')}`,
        nodeIds: [node.id],
      });
    try {
      ports.set(
        node.id,
        definition.resolvePorts
          ? await definition.resolvePorts(node.config, resources)
          : { inputs: definition.inputs, outputs: definition.outputs },
      );
    } catch (error) {
      errors.push({
        message: `"${nameOf(node.id)}" could not resolve its ports: ${error instanceof Error ? error.message : String(error)}`,
        nodeIds: [node.id],
      });
    }
  }
  const chatInputs = workflow.nodes.filter((node) => node.type === 'chat-input');
  if (chatInputs.length !== 1)
    errors.push({
      message: 'A workflow must contain exactly one chat-input node.',
      nodeIds: chatInputs.map((node) => node.id),
    });
  if (!workflow.nodes.some((node) => node.type === 'chat-output'))
    errors.push({ message: 'A workflow must contain at least one chat-output node.' });
  const edgeIds = new Set<string>();
  const inbound = new Map<string, number>(workflow.nodes.map((node) => [node.id, 0]));
  const adjacency = new Map<string, string[]>(workflow.nodes.map((node) => [node.id, []]));
  const incoming = new Map<string, Edge[]>(workflow.nodes.map((node) => [node.id, []]));
  const upstream = new Map<string, string[]>(workflow.nodes.map((node) => [node.id, []]));
  for (const edge of workflow.edges) {
    if (edgeIds.has(edge.id))
      errors.push({
        message: 'More than one connection uses the same id; every connection needs a unique id.',
        edgeId: edge.id,
      });
    edgeIds.add(edge.id);
    const source = workflow.nodes.find((node) => node.id === edge.source);
    const target = workflow.nodes.find((node) => node.id === edge.target);
    if (!source || !target) {
      errors.push({
        message: "This connection references a node that doesn't exist.",
        edgeId: edge.id,
        nodeIds: [edge.source, edge.target],
      });
      continue;
    }
    incoming.get(edge.target)!.push(edge);
    upstream.get(edge.target)!.push(edge.source);
    const sourcePorts = ports.get(source.id);
    const targetPorts = ports.get(target.id);
    const sourcePort = sourcePorts?.outputs.find((port) => port.name === edge.sourceHandle);
    const targetPort = targetPorts?.inputs.find((port) => port.name === edge.targetHandle);
    const connection = `Connection from "${nameOf(source.id)}" [output "${edge.sourceHandle}"] to "${nameOf(target.id)}" [input "${edge.targetHandle}"]`;
    // Only flag a missing handle when its node's ports were resolved; otherwise the handle can't be verified.
    if (sourcePorts && !sourcePort)
      errors.push({
        message: `${connection}: "${nameOf(source.id)}" has no output called "${edge.sourceHandle}". Available outputs: ${availablePorts(sourcePorts.outputs)}.`,
        edgeId: edge.id,
        nodeIds: [source.id, target.id],
      });
    if (targetPorts && !targetPort)
      errors.push({
        message: `${connection}: "${nameOf(target.id)}" has no input called "${edge.targetHandle}". Available inputs: ${availablePorts(targetPorts.inputs)}.`,
        edgeId: edge.id,
        nodeIds: [source.id, target.id],
      });
    if (sourcePort && targetPort) {
      const compatibility = canConnect(sourcePort, targetPort);
      if (!compatibility.ok)
        errors.push({
          message: `${connection}: ${compatibility.reason}.`,
          edgeId: edge.id,
          nodeIds: [source.id, target.id],
        });
    }
    if (
      workflow.edges.some(
        (item) => item !== edge && item.target === edge.target && item.targetHandle === edge.targetHandle,
      )
    )
      errors.push({
        message: `"${nameOf(target.id)}" has more than one connection into "${edge.targetHandle}"; keep only one.`,
        edgeId: edge.id,
        nodeIds: [target.id],
      });
    inbound.set(edge.target, (inbound.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }
  for (const node of workflow.nodes) {
    for (const port of ports.get(node.id)?.inputs.filter((item) => item.required) ?? []) {
      if (!workflow.edges.some((edge) => edge.target === node.id && edge.targetHandle === port.name))
        errors.push({
          message: `"${nameOf(node.id)}" needs a connection into required input "${port.name}".`,
          nodeIds: [node.id],
        });
    }
    if (node.type === 'chat-input' && (inbound.get(node.id) ?? 0))
      errors.push({
        message: `"${nameOf(node.id)}" can't have connections coming into it.`,
        nodeIds: [node.id],
      });
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
  if (visited !== workflow.nodes.length)
    errors.push({ message: 'The connections form a loop; a workflow cannot contain a cycle.' });
  if (errors.length) {
    const seen = new Set<string>();
    return {
      errors: errors.filter((issue) => {
        const key = JSON.stringify([issue.message, issue.edgeId, issue.nodeIds]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    };
  }
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

export async function validateWorkflow(workflow: Workflow, resources?: NodeResources): Promise<ValidationIssue[]> {
  return (await prepareWorkflow(workflow, resources)).errors;
}
