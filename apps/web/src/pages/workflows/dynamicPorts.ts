import type { Edge } from '@xyflow/react';
import { isPlainObject, type ApiResponse, type NodeInstance } from '@st/shared';
import type { CanvasNode } from './model.js';

type Ports = ApiResponse<'resolvePorts'>;
type PortRequest = { id: string; type: string; config: NodeInstance['config']; unset: string[] };

/**
 * The required text settings (a JSON-schema `minLength` of 1 or more, no default) that a config leaves blank. A node
 * with such a setting has not been set up yet (State Read before a definition is picked); its panel says what to
 * pick, and failing to resolve its ports is no mistake to report.
 */
export function unsetSettings(schema: Record<string, unknown>, config: NodeInstance['config']): string[] {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  return Object.entries(properties).flatMap(([name, rule]) => {
    if (!isPlainObject(rule) || rule.type !== 'string' || !(Number(rule.minLength) > 0) || 'default' in rule) return [];
    const value = config[name];
    return typeof value === 'string' && value.trim() ? [] : [name];
  });
}

export function portRequests(nodes: CanvasNode[]): PortRequest[] {
  return nodes
    .filter((node) => !node.data.unknown && node.data.descriptor.dynamicPorts)
    .map((node) => ({
      id: node.id,
      type: node.data.descriptor.type,
      config: node.data.config,
      unset: unsetSettings(node.data.descriptor.configSchema, node.data.config),
    }));
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

/**
 * The error toasts of nodes whose ports could not be resolved: one per node and message (a re-run that fails the
 * same way adds nothing), dismissed as soon as the node resolves, is deleted, or fails differently. A node that is
 * still being set up (`setUp` false: a required setting is blank, see `unsetSettings`) gets no toast, since its
 * panel already says what to pick; it also takes back the toast it had.
 */
export function createPortErrors(alerts: { error(message: string): string; dismiss(id: string): void }) {
  const shown = new Map<string, { message: string; alertId: string }>();
  const resolved = (nodeId: string) => {
    const current = shown.get(nodeId);
    if (!current) return;
    alerts.dismiss(current.alertId);
    shown.delete(nodeId);
  };
  return {
    failed(nodeId: string, message: string, setUp = true) {
      if (!setUp) return resolved(nodeId);
      if (shown.get(nodeId)?.message === message) return;
      resolved(nodeId);
      shown.set(nodeId, { message, alertId: alerts.error(message) });
    },
    resolved,
    /** Drops the errors of nodes that are no longer on the canvas. */
    keepOnly(nodeIds: ReadonlySet<string>) {
      for (const nodeId of [...shown.keys()]) if (!nodeIds.has(nodeId)) resolved(nodeId);
    },
  };
}
