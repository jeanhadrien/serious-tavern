import { canConnect, coerceValue } from '@st/shared/ports';
import type { ExecutionLog, NodeSkip } from '@st/shared';
import type { Edge } from '@xyflow/react';
import type { CanvasNode } from './model.js';

/** One input of a node in a past run: what reached it, rebuilt from the sources' outputs in the log. */
interface LastRunInput {
  port: string;
  label: string;
  /** False when nothing reached it: its source was skipped, failed or didn't produce the port. */
  arrived: boolean;
  value?: unknown;
}

export interface LastRunIO {
  status: ExecutionLog['nodes'][string]['status'];
  skip?: NodeSkip;
  error?: string;
  /** The node's output in the log; absent when it produced none. */
  output?: unknown;
  inputs: LastRunInput[];
}

/**
 * What the log says a node received and produced in a past run of the workflow. The output is the log's own; the inputs
 * are REBUILT from the upstream nodes' outputs along the draft's connections, converted as the executor converts them
 * (`canConnect` and `coerceValue`), so they are only right while the graph is unchanged since the run (the log's
 * `workflowUpdatedAt` against the workflow's `updatedAt` tells). Undefined when the run never reached the node.
 */
export function lastRunIO(
  log: ExecutionLog,
  nodeId: string,
  edges: readonly Pick<Edge, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>[],
  nodes: readonly CanvasNode[],
): LastRunIO | undefined {
  const own = log.nodes[nodeId];
  const descriptor = nodes.find((node) => node.id === nodeId)?.data.descriptor;
  if (!own || !descriptor) return undefined;
  const inputs = descriptor.inputs.flatMap((port): LastRunInput[] => {
    const edge = edges.find((item) => item.target === nodeId && item.targetHandle === port.name);
    if (!edge) return [];
    const source = log.nodes[edge.source];
    const sourcePort = nodes
      .find((node) => node.id === edge.source)
      ?.data.descriptor.outputs.find((item) => item.name === edge.sourceHandle);
    const produced =
      source?.status === 'completed' &&
      typeof source.output === 'object' &&
      source.output !== null &&
      edge.sourceHandle != null &&
      Object.hasOwn(source.output, edge.sourceHandle);
    if (!produced || !sourcePort) return [{ port: port.name, label: port.label, arrived: false }];
    const value = (source.output as Record<string, unknown>)[edge.sourceHandle as string];
    const connection = canConnect(sourcePort, port);
    return [
      {
        port: port.name,
        label: port.label,
        arrived: true,
        value: connection.ok && connection.coerce ? coerceValue(value, connection.coerce) : value,
      },
    ];
  });
  return {
    status: own.status,
    ...(own.skip && { skip: own.skip }),
    ...(own.error !== undefined && { error: own.error }),
    ...(own.output !== undefined && { output: own.output }),
    inputs,
  };
}

/** A value as the panel shows it: text as it is, anything else as pretty JSON, cut at `limit` characters. */
export function previewValue(value: unknown, limit = 600): { text: string; truncated: boolean } {
  const text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value));
  return text.length > limit ? { text: `${text.slice(0, limit)}…`, truncated: true } : { text, truncated: false };
}

/**
 * Whether a past run's inputs may no longer match the graph: the draft has unsaved edits, or the workflow was saved
 * after the run started. A log without a stamp (an older run) cannot be vouched for.
 */
export const lastRunIsStale = (
  log: Pick<ExecutionLog, 'workflowUpdatedAt'>,
  dirty: boolean,
  updatedAt: string,
): boolean => dirty || log.workflowUpdatedAt !== updatedAt;
