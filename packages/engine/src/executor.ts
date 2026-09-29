import { randomUUID } from 'node:crypto';
import type { Workflow, ChatMessage, ExecutionLog, Edge } from '@st/shared';
import { registry } from './registry.js';
import type { EngineEvent, ExecutionContext } from './types.js';
import { stringify } from './template.js';

export function validateWorkflow(workflow: Workflow): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const node of workflow.nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
    const definition = registry.get(node.type);
    if (!definition) { errors.push(`Node ${node.id}: unknown type ${node.type}`); continue; }
    const parsed = definition.configSchema.safeParse(node.config);
    if (!parsed.success) errors.push(`Node ${node.id}: invalid config: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  }
  for (const type of ['chat-input', 'chat-output']) {
    if (workflow.nodes.filter(n => n.type === type).length !== 1) errors.push(`Expected exactly one ${type} node`);
  }
  const edgeIds = new Set<string>();
  const inbound = new Map<string, number>(workflow.nodes.map(n => [n.id, 0]));
  const adjacency = new Map<string, string[]>(workflow.nodes.map(n => [n.id, []]));
  for (const edge of workflow.edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    const source = workflow.nodes.find(n => n.id === edge.source);
    const target = workflow.nodes.find(n => n.id === edge.target);
    if (!source || !target) { errors.push(`Edge ${edge.id}: missing source or target node`); continue; }
    if (!registry.get(source.type)?.outputs.some(p => p.name === edge.sourceHandle)) errors.push(`Edge ${edge.id}: invalid output port ${edge.sourceHandle}`);
    if (!registry.get(target.type)?.inputs.some(p => p.name === edge.targetHandle)) errors.push(`Edge ${edge.id}: invalid input port ${edge.targetHandle}`);
    if (workflow.edges.some(e => e !== edge && e.target === edge.target && e.targetHandle === edge.targetHandle)) errors.push(`Edge ${edge.id}: input ${target.id}.${edge.targetHandle} has multiple connections`);
    inbound.set(edge.target, (inbound.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }
  for (const node of workflow.nodes) {
    const definition = registry.get(node.type);
    for (const port of definition?.inputs.filter(p => p.required) ?? []) {
      if (!workflow.edges.some(e => e.target === node.id && e.targetHandle === port.name)) errors.push(`Node ${node.id}: required input ${port.name} is not connected`);
    }
    if (node.type === 'chat-input' && (inbound.get(node.id) ?? 0)) errors.push('Chat input cannot have incoming edges');
  }
  const degrees = new Map(inbound);
  const queue = [...degrees].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!; visited++;
    for (const next of adjacency.get(id) ?? []) {
      degrees.set(next, degrees.get(next)! - 1);
      if (degrees.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== workflow.nodes.length) errors.push('Workflow contains a cycle');
  return [...new Set(errors)];
}

export class ExecutionFailure extends Error {
  constructor(message: string, public readonly execution: ExecutionLog) { super(message); }
}

export async function executeWorkflow(
  workflow: Workflow,
  options: {
    message: string; sessionId: string; history: ChatMessage[];
    secrets: ExecutionContext['secrets']; signal?: AbortSignal;
    onEvent?: (event: EngineEvent) => void; nodeTimeoutMs?: number;
  }
): Promise<{ reply: string; execution: ExecutionLog }> {
  const errors = validateWorkflow(workflow);
  if (errors.length) throw new Error(`Invalid workflow: ${errors.join('; ')}`);
  const execution: ExecutionLog = {
    id: randomUUID(), workflowId: workflow.id, sessionId: options.sessionId,
    status: 'running', startedAt: new Date().toISOString(), nodes: {}
  };
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const emit = (event: EngineEvent) => options.onEvent?.(event);
  const resolved = new Map<string, { output: Record<string, unknown>; skipped: boolean }>();
  const pending = new Set(workflow.nodes.map(n => n.id));
  try {
    while (pending.size) {
      if (controller.signal.aborted) throw new Error('Execution aborted');
      const ready = workflow.nodes.filter(n => pending.has(n.id) &&
        workflow.edges.filter(e => e.target === n.id).every(e => resolved.has(e.source)));
      if (!ready.length) throw new Error('Workflow cannot make progress');
      await Promise.all(ready.map(async node => {
        const incoming: Edge[] = workflow.edges.filter(e => e.target === node.id);
        const active = incoming.filter(e => {
          const source = resolved.get(e.source)!;
          return !source.skipped && Object.hasOwn(source.output, e.sourceHandle);
        });
        const inputs = Object.fromEntries(active.map(e => [e.targetHandle, resolved.get(e.source)!.output[e.sourceHandle]]));
        const definition = registry.get(node.type)!;
        const requiredSkipped = definition.inputs.some(p => p.required &&
          incoming.some(e => e.targetHandle === p.name) && !Object.hasOwn(inputs, p.name));
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
        try {
          const output = await Promise.race([
            definition.execute({
              inputs, config: definition.configSchema.parse(node.config), trigger: { message: options.message, sessionId: options.sessionId },
              history: options.history, secrets: options.secrets, signal, log: () => {}, emit
            }),
            new Promise<never>((_, reject) => {
              if (signal.aborted) reject(signal.reason);
              else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            })
          ]);
          if (!output || typeof output !== 'object' || Object.keys(output).some(key => !definition.outputs.some(p => p.name === key))) {
            throw new Error('Node returned invalid output ports');
          }
          execution.nodes[node.id] = { ...execution.nodes[node.id], status: 'completed',
            finishedAt: new Date().toISOString(), durationMs: Date.now() - start, output };
          resolved.set(node.id, { output, skipped: false });
          emit({ type: 'node:complete', nodeId: node.id, detail: output });
        } catch (cause) {
          const reason = timer.aborted ? `timed out after ${timeoutMs}ms` : cause instanceof Error ? cause.message : String(cause);
          execution.nodes[node.id] = { ...execution.nodes[node.id], status: 'error',
            finishedAt: new Date().toISOString(), durationMs: Date.now() - start, error: reason };
          emit({ type: 'node:error', nodeId: node.id, detail: reason });
          controller.abort();
          throw new Error(`Node ${node.id} (${node.type}): ${reason}`);
        }
      }));
      ready.forEach(n => pending.delete(n.id));
    }
    const outputNode = workflow.nodes.find(n => n.type === 'chat-output')!;
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
