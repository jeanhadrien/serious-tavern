import { randomUUID } from 'node:crypto';
import { canConnect, type CoercionKind } from '@st/shared/ports';
import type { Character, Workflow, ChatMessage, ExecutionLog, Edge, Persona } from '@st/shared';
import { registry } from './registry.js';
import type { EngineEvent, ExecutionContext, NodeResources } from './types.js';
import { stringify } from './template.js';

function coerceValue(value: unknown, kind: CoercionKind): string {
  if (kind === 'messages-to-text') {
    if (!Array.isArray(value)) return stringify(value);
    return value.map((message: ChatMessage) => `${message.role}: ${message.content}`).join('\n');
  }
  if (value != null && typeof value === 'object') return JSON.stringify(value, null, 2);
  return value == null ? '' : String(value);
}

export async function validateWorkflow(
  workflow: Workflow,
  resources: NodeResources = { presets: { get: async () => undefined } },
): Promise<string[]> {
  const errors: string[] = [];
  const ids = new Set<string>();
  const ports = new Map<string, { inputs: import('@st/shared').PortDef[]; outputs: import('@st/shared').PortDef[] }>();
  for (const node of workflow.nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
    const definition = registry.get(node.type);
    if (!definition) {
      errors.push(`Node ${node.id}: unknown type ${node.type}`);
      continue;
    }
    const parsed = definition.configSchema.safeParse(node.config);
    if (!parsed.success)
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
  for (const type of ['chat-input', 'chat-output']) {
    if (workflow.nodes.filter((n) => n.type === type).length !== 1) errors.push(`Expected exactly one ${type} node`);
  }
  const edgeIds = new Set<string>();
  const inbound = new Map<string, number>(workflow.nodes.map((n) => [n.id, 0]));
  const adjacency = new Map<string, string[]>(workflow.nodes.map((n) => [n.id, []]));
  for (const edge of workflow.edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    const source = workflow.nodes.find((n) => n.id === edge.source);
    const target = workflow.nodes.find((n) => n.id === edge.target);
    if (!source || !target) {
      errors.push(`Edge ${edge.id}: missing source or target node`);
      continue;
    }
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
  return [...new Set(errors)];
}

export class ExecutionFailure extends Error {
  constructor(
    message: string,
    public readonly execution: ExecutionLog,
  ) {
    super(message);
  }
}

export async function executeWorkflow(
  workflow: Workflow,
  options: {
    message: string;
    sessionId: string;
    history: ChatMessage[];
    secrets: ExecutionContext['secrets'];
    signal?: AbortSignal;
    character?: Character;
    persona?: Persona;
    resources?: NodeResources;
    onEvent?: (event: EngineEvent) => void;
    nodeTimeoutMs?: number;
  },
): Promise<{ reply: string; execution: ExecutionLog }> {
  const snapshot = new Map<string, import('@st/shared').Preset | undefined>();
  const resources: NodeResources = {
    presets: {
      get: async (id) => {
        if (!snapshot.has(id)) snapshot.set(id, await options.resources?.presets.get(id));
        return snapshot.get(id);
      },
    },
  };
  await Promise.all(
    [...new Set(workflow.nodes.filter((n) => n.type === 'llm').map((n) => String(n.config.presetId ?? '')))].map((id) =>
      resources.presets.get(id),
    ),
  );
  const errors = await validateWorkflow(workflow, resources);
  if (errors.length) throw new Error(`Invalid workflow: ${errors.join('; ')}`);
  const execution: ExecutionLog = {
    id: randomUUID(),
    workflowId: workflow.id,
    sessionId: options.sessionId,
    status: 'running',
    startedAt: new Date().toISOString(),
    nodes: {},
  };
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const emit = (event: EngineEvent) => options.onEvent?.(event);
  const resolved = new Map<string, { output: Record<string, unknown>; skipped: boolean }>();
  const ports = new Map(
    await Promise.all(
      workflow.nodes.map(async (node) => {
        const definition = registry.get(node.type)!;
        return [
          node.id,
          definition.resolvePorts
            ? await definition.resolvePorts(node.config, resources)
            : { inputs: definition.inputs, outputs: definition.outputs },
        ] as const;
      }),
    ),
  );
  const outputNode = workflow.nodes.find((n) => n.type === 'chat-output')!;
  const upstream = new Map<string, string[]>(workflow.nodes.map((node) => [node.id, []]));
  for (const edge of workflow.edges) upstream.get(edge.target)?.push(edge.source);
  const reachable = new Set<string>();
  const visit = [outputNode.id];
  while (visit.length) {
    const id = visit.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    visit.push(...(upstream.get(id) ?? []));
  }
  const pending = new Set(workflow.nodes.filter((node) => reachable.has(node.id)).map((node) => node.id));
  for (const node of workflow.nodes.filter((item) => !reachable.has(item.id))) {
    const timestamp = new Date().toISOString();
    execution.nodes[node.id] = { status: 'skipped', startedAt: timestamp, finishedAt: timestamp, durationMs: 0 };
    resolved.set(node.id, { output: {}, skipped: true });
    emit({ type: 'node:skipped', nodeId: node.id, detail: 'unreachable from chat output' });
  }
  try {
    while (pending.size) {
      if (controller.signal.aborted) throw new Error('Execution aborted');
      const ready = workflow.nodes.filter(
        (n) =>
          pending.has(n.id) && workflow.edges.filter((e) => e.target === n.id).every((e) => resolved.has(e.source)),
      );
      if (!ready.length) throw new Error('Workflow cannot make progress');
      let firstFailure: Error | undefined;
      await Promise.allSettled(
        ready.map(async (node) => {
          const incoming: Edge[] = workflow.edges.filter((e) => e.target === node.id);
          const active = incoming.filter((e) => {
            const source = resolved.get(e.source)!;
            return !source.skipped && Object.hasOwn(source.output, e.sourceHandle);
          });
          const definition = registry.get(node.type)!;
          const inputs = Object.fromEntries(
            active.map((e) => {
              const source = workflow.nodes.find((item) => item.id === e.source)!;
              const fromPort = ports.get(source.id)!.outputs.find((port) => port.name === e.sourceHandle)!;
              const toPort = ports.get(node.id)!.inputs.find((port) => port.name === e.targetHandle)!;
              const connection = canConnect(fromPort, toPort);
              const value = resolved.get(e.source)!.output[e.sourceHandle];
              return [
                e.targetHandle,
                connection.ok && connection.coerce ? coerceValue(value, connection.coerce) : value,
              ];
            }),
          );
          const requiredSkipped = ports
            .get(node.id)!
            .inputs.some(
              (p) => p.required && incoming.some((e) => e.targetHandle === p.name) && !Object.hasOwn(inputs, p.name),
            );
          if ((incoming.length > 0 && active.length === 0) || (node.type !== 'merge' && requiredSkipped)) {
            const now = new Date().toISOString();
            execution.nodes[node.id] = { status: 'skipped', startedAt: now, finishedAt: now, durationMs: 0 };
            resolved.set(node.id, { output: {}, skipped: true });
            emit({ type: 'node:skipped', nodeId: node.id });
            return;
          }
          const start = Date.now();
          execution.nodes[node.id] = { status: 'running', startedAt: new Date(start).toISOString() };
          emit({ type: 'node:start', nodeId: node.id });
          const timeoutMs = definition.timeoutMs ?? options.nodeTimeoutMs ?? 30000;
          const timer = AbortSignal.timeout(timeoutMs);
          const signal = AbortSignal.any([controller.signal, timer]);
          let callbacksActive = true;
          const task = Promise.resolve().then(() =>
            definition.execute({
              inputs,
              config: definition.configSchema.parse(node.config),
              trigger: { message: options.message, sessionId: options.sessionId },
              history: options.history,
              character: options.character,
              persona: options.persona,
              secrets: options.secrets,
              resources,
              signal,
              log: () => {},
              recordRequest: (request) => {
                if (callbacksActive) execution.nodes[node.id] = { ...execution.nodes[node.id]!, request };
              },
              emit: (event) => {
                if (callbacksActive) emit(event);
              },
            }),
          );
          let abortListener: (() => void) | undefined;
          const interrupted = new Promise<never>((_, reject) => {
            abortListener = () => reject(signal.reason ?? new Error('Node execution aborted'));
            if (signal.aborted) abortListener();
            else signal.addEventListener('abort', abortListener, { once: true });
          });
          try {
            const output = await Promise.race([task, interrupted]);
            callbacksActive = false;
            if (abortListener) signal.removeEventListener('abort', abortListener);
            if (controller.signal.aborted) {
              execution.nodes[node.id] = {
                ...execution.nodes[node.id],
                status: 'cancelled',
                finishedAt: new Date().toISOString(),
                durationMs: Date.now() - start,
              };
              emit({ type: 'node:cancelled', nodeId: node.id });
              return;
            }
            if (
              !output ||
              typeof output !== 'object' ||
              Object.keys(output).some((key) => !ports.get(node.id)!.outputs.some((p) => p.name === key))
            ) {
              throw new Error('Node returned invalid output ports');
            }
            for (const port of ports.get(node.id)!.outputs) {
              if (
                !port.optional &&
                workflow.edges.some((edge) => edge.source === node.id && edge.sourceHandle === port.name) &&
                !Object.hasOwn(output, port.name)
              )
                throw new Error(`Node did not produce output "${port.name}"`);
            }
            execution.nodes[node.id] = {
              ...execution.nodes[node.id],
              status: 'completed',
              finishedAt: new Date().toISOString(),
              durationMs: Date.now() - start,
              output,
            };
            resolved.set(node.id, { output, skipped: false });
            emit({ type: 'node:complete', nodeId: node.id, detail: output });
          } catch (cause) {
            callbacksActive = false;
            if (abortListener) signal.removeEventListener('abort', abortListener);
            if (controller.signal.aborted && !timer.aborted)
              await task.then(
                () => undefined,
                () => undefined,
              );
            const reason = timer.aborted
              ? `timed out after ${timeoutMs}ms`
              : cause instanceof Error
                ? cause.message
                : String(cause);
            if (controller.signal.aborted && !timer.aborted) {
              execution.nodes[node.id] = {
                ...execution.nodes[node.id],
                status: 'cancelled',
                finishedAt: new Date().toISOString(),
                durationMs: Date.now() - start,
                error: reason,
              };
              emit({ type: 'node:cancelled', nodeId: node.id, detail: reason });
            } else {
              execution.nodes[node.id] = {
                ...execution.nodes[node.id],
                status: 'error',
                finishedAt: new Date().toISOString(),
                durationMs: Date.now() - start,
                error: reason,
              };
              emit({ type: 'node:error', nodeId: node.id, detail: reason });
              firstFailure ??= new Error(`Node ${node.id} (${node.type}): ${reason}`);
              controller.abort(cause);
            }
          }
        }),
      );
      if (firstFailure) throw firstFailure;
      if (controller.signal.aborted) throw new Error('Execution aborted');
      ready.forEach((n) => pending.delete(n.id));
    }
    const result = resolved.get(outputNode.id);
    if (!result || result.skipped) throw new Error(`Chat output ${outputNode.id} was skipped`);
    execution.status = 'completed';
    return { reply: stringify(result.output.reply), execution };
  } catch (cause) {
    execution.status = 'error';
    throw new ExecutionFailure(cause instanceof Error ? cause.message : String(cause), execution);
  } finally {
    execution.finishedAt = new Date().toISOString();
    emit({ type: 'execution:complete', detail: execution.status });
    options.signal?.removeEventListener('abort', onAbort);
  }
}
