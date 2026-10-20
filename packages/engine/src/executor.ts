import { randomUUID } from 'node:crypto';
import { canConnect } from '@st/shared/ports';
import { nodeDisplayName } from '@st/shared';
import type {
  Character,
  Workflow,
  ChatMessage,
  ExecutionLog,
  Edge,
  Persona,
  StateSnapshot,
  StateWrite,
} from '@st/shared';
import { labelOf, prepareWorkflow, type PreparedWorkflow } from './prepare.js';
export { validateWorkflow } from './prepare.js';
import type { ChatReply, EngineEvent, ExecutionContext, NodeResources } from './types.js';
import { stringify, coerceValue } from './text.js';
import { orderReplies } from './replies.js';
import { createRandom } from './seeded-random.js';
import { StateRun } from './state-writes.js';

class NodeExecutionError extends Error {
  constructor(
    public readonly nodeId: string,
    public readonly nodeType: string,
    reason: string,
  ) {
    super(`Node ${nodeId} (${nodeType}): ${reason}`);
  }
}

export class ExecutionFailure extends Error {
  constructor(
    message: string,
    public readonly execution: ExecutionLog,
    public readonly replies: ChatReply[] = [],
    public readonly nodeId?: string,
    public readonly nodeType?: string,
    // The state writes of the nodes that completed before the run failed or was stopped.
    public readonly writes: StateWrite[] = [],
  ) {
    super(message);
  }
}

export async function executeWorkflow(
  input: Workflow | PreparedWorkflow,
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
    // Lets the caller know the execution id before the run starts (streaming announces it up front).
    executionId?: string;
    // Seeds every node's `ctx.random()`; generated when absent. Recorded as `execution.seed`.
    seed?: string;
    // Chat settings, already resolved against the workflow (`resolveChatSettings`). Recorded as
    // `execution.settings` and exposed as `ctx.settings`.
    settings?: Record<string, unknown>;
    // The story state the turn starts from (`foldStoryState` + `stateSnapshot`): what `ctx.state` reads and
    // `trigger.turn` reports. Writes nodes ask for are returned as `writes`, never visible during the run.
    state?: StateSnapshot;
    // Folds the story state again with extra writes of this run (the caller's own `state` arguments plus `pending`:
    // `FoldInput.pending`). Lets a node read its own buffered writes (`ctx.pendingState`) without the engine knowing
    // how the caller folds. Without it a node reads the same snapshot as `ctx.state`.
    foldWith?: (pending: StateWrite[]) => StateSnapshot;
    // The replies the runs above this one saved in this turn, in chat order: Chat Input's `replies` (`[]` by default).
    replies?: ChatMessage[];
  },
): Promise<{ replies: ChatReply[]; execution: ExecutionLog; writes: StateWrite[] }> {
  // NB: Workflow is a passthrough (loose) object for forward compatibility, so `in`
  // narrowing does not discriminate it from PreparedWorkflow; check the prepared marker instead.
  const isPrepared = (value: Workflow | PreparedWorkflow): value is PreparedWorkflow =>
    (value as PreparedWorkflow).definitions instanceof Map;
  const preparation = isPrepared(input)
    ? { errors: [], prepared: input }
    : await prepareWorkflow(input, options.resources);
  if (!preparation.prepared)
    throw new Error(`Invalid workflow: ${preparation.errors.map((issue) => issue.message).join('; ')}`);
  const { workflow, resources, definitions, ports, incoming, upstream, reachable } = preparation.prepared;
  const seed = options.seed ?? randomUUID();
  const settings = Object.freeze({ ...options.settings });
  const execution: ExecutionLog = {
    id: options.executionId ?? randomUUID(),
    workflowId: workflow.id,
    sessionId: options.sessionId,
    seed,
    settings: { ...settings },
    status: 'running',
    startedAt: new Date().toISOString(),
    nodes: {},
    warnings: [],
  };
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const emit = (event: EngineEvent) => {
    // Observers are best-effort notifications, never part of the workflow outcome.
    try {
      options.onEvent?.(event);
    } catch {
      // Observer exceptions must not disrupt execution or cancellation cleanup.
    }
  };
  // One stream per node and run (a node executes at most once), created on its first draw.
  const createNodeRandom = (streamSeed: string) => {
    let next: (() => number) | undefined;
    return () => {
      next ??= createRandom(streamSeed);
      return next();
    };
  };
  const stateRun = new StateRun(options.state, execution, workflow.id, options.foldWith);
  let wave = 0;
  const resolved = new Map<string, { output: Record<string, unknown>; skipped: boolean }>();
  const replies = new Map<string, ChatReply>();
  const pending = new Set(workflow.nodes.filter((node) => reachable.has(node.id)).map((node) => node.id));
  for (const { id: nodeId } of workflow.nodes.filter((node) => !reachable.has(node.id))) {
    const timestamp = new Date().toISOString();
    execution.nodes[nodeId] = {
      status: 'skipped',
      startedAt: timestamp,
      finishedAt: timestamp,
      durationMs: 0,
    };
    resolved.set(nodeId, { output: {}, skipped: true });
    emit({ type: 'node:skipped', nodeId, detail: 'not needed by any output' });
  }
  try {
    while (pending.size) {
      wave++;
      if (controller.signal.aborted) throw new Error('Execution aborted');
      const ready = workflow.nodes.filter(
        (n) => pending.has(n.id) && incoming.get(n.id)!.every((e) => resolved.has(e.source)),
      );
      if (!ready.length) throw new Error('Workflow cannot make progress');
      let firstFailure: Error | undefined;
      const results = await Promise.allSettled(
        ready.map(async (node) => {
          const nodeWave = wave;
          const start = Date.now();
          let timeoutMs = options.nodeTimeoutMs ?? 30000;
          let timer: AbortSignal | undefined;
          let signal: AbortSignal | undefined;
          let task: Promise<Record<string, unknown>> | undefined;
          let callbacksActive = true;
          // Set by `ctx.beginWire`: the next recorded exchange is a new call, not an update of the last one.
          let newWireCall = false;
          let abortListener: (() => void) | undefined;
          try {
            const edges: Edge[] = incoming.get(node.id)!;
            const active = edges.filter((e) => {
              const source = resolved.get(e.source)!;
              return !source.skipped && Object.hasOwn(source.output, e.sourceHandle);
            });
            const definition = definitions.get(node.id)!;
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
                (p) =>
                  (p.required || p.requiredIfConnected) &&
                  edges.some((e) => e.targetHandle === p.name) &&
                  !Object.hasOwn(inputs, p.name),
              );
            // A node whose every gating connection is inactive is skipped; `neverSkips` inputs never gate.
            const nodeInputs = ports.get(node.id)!.inputs;
            const gates = (e: Edge) => !nodeInputs.find((p) => p.name === e.targetHandle)?.neverSkips;
            const gating = edges.filter(gates);
            if ((gating.length > 0 && !active.some(gates)) || (node.type !== 'merge' && requiredSkipped)) {
              const now = new Date().toISOString();
              execution.nodes[node.id] = { status: 'skipped', startedAt: now, finishedAt: now, durationMs: 0 };
              resolved.set(node.id, { output: {}, skipped: true });
              emit({ type: 'node:skipped', nodeId: node.id });
              return;
            }
            execution.nodes[node.id] = { status: 'running', startedAt: new Date(start).toISOString() };
            emit({ type: 'node:start', nodeId: node.id });
            timeoutMs = definition.timeoutMs ?? timeoutMs;
            timer = AbortSignal.timeout(timeoutMs);
            const nodeSignal = AbortSignal.any([controller.signal, timer]);
            signal = nodeSignal;
            task = Promise.resolve().then(() =>
              definition.execute({
                nodeId: node.id,
                inputs,
                config: node.config,
                trigger: { message: options.message, sessionId: options.sessionId, ...stateRun.trigger },
                history: options.history,
                character: options.character,
                persona: options.persona,
                settings,
                secrets: options.secrets,
                resources,
                replies: structuredClone(options.replies ?? []),
                signal: nodeSignal,
                log: (message) => {
                  if (!callbacksActive) return;
                  const entry = execution.nodes[node.id]!;
                  execution.nodes[node.id] = { ...entry, logs: [...(entry.logs ?? []), message] };
                },
                random: createNodeRandom(`${seed}:${node.id}`),
                ...stateRun.context(node.id, () => callbacksActive),
                beginWire: () => {
                  newWireCall = true;
                },
                recordWire: (wire) => {
                  if (!callbacksActive) return;
                  const entry = execution.nodes[node.id]!;
                  const wires = entry.wires ?? [];
                  const replacesLast = wires.length > 0 && !newWireCall;
                  newWireCall = false;
                  execution.nodes[node.id] = {
                    ...entry,
                    wires: [...(replacesLast ? wires.slice(0, -1) : wires), wire],
                  };
                },
                emit: (event) => {
                  if (callbacksActive) emit(event);
                },
              }),
            );
            const interrupted = new Promise<never>((_, reject) => {
              abortListener = () => reject(nodeSignal.reason ?? new Error('Node execution aborted'));
              if (nodeSignal.aborted) abortListener();
              else nodeSignal.addEventListener('abort', abortListener, { once: true });
            });
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
            if (node.type === 'chat-output') {
              const character = inputs.character as Character | undefined;
              const name = character?.name || String(node.config.name ?? '');
              replies.set(node.id, {
                nodeId: node.id,
                content: stringify(output.reply),
                ...(name ? { name } : {}),
                ...(character ? { characterId: character.id } : {}),
              });
            }
            // Only now do the node's state writes count: an error or a cancellation above drops them.
            stateRun.commit(node.id, nodeWave);
            resolved.set(node.id, { output, skipped: false });
            emit({ type: 'node:complete', nodeId: node.id, detail: output });
          } catch (cause) {
            callbacksActive = false;
            if (abortListener) signal?.removeEventListener('abort', abortListener);
            const cancelled = controller.signal.aborted;
            if (cancelled && task) {
              // Cleanup retains the original node deadline. Abort-ignoring work may
              // continue afterwards, but its callbacks and results are ignored.
              let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
              await Promise.race([
                task.then(
                  () => undefined,
                  () => undefined,
                ),
                new Promise<void>((resolve) => {
                  cleanupTimer = setTimeout(resolve, Math.max(0, start + timeoutMs - Date.now()));
                }),
              ]);
              clearTimeout(cleanupTimer);
            }
            const reason =
              !cancelled && timer?.aborted
                ? `timed out after ${timeoutMs}ms`
                : cause instanceof Error
                  ? cause.message
                  : String(cause);
            if (cancelled) {
              execution.nodes[node.id] = {
                ...execution.nodes[node.id],
                startedAt: execution.nodes[node.id]?.startedAt ?? new Date(start).toISOString(),
                status: 'cancelled',
                finishedAt: new Date().toISOString(),
                durationMs: Date.now() - start,
                error: reason,
              };
              emit({ type: 'node:cancelled', nodeId: node.id, detail: reason });
            } else {
              execution.nodes[node.id] = {
                ...execution.nodes[node.id],
                startedAt: execution.nodes[node.id]?.startedAt ?? new Date(start).toISOString(),
                status: 'error',
                finishedAt: new Date().toISOString(),
                durationMs: Date.now() - start,
                error: reason,
              };
              firstFailure ??= new NodeExecutionError(node.id, node.type, reason);
              controller.abort(cause);
              emit({ type: 'node:error', nodeId: node.id, detail: reason });
            }
          }
        }),
      );
      if (firstFailure) throw firstFailure;
      const rejected = results.find((result) => result.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
      if (controller.signal.aborted) throw new Error('Execution aborted');
      ready.forEach((n) => {
        pending.delete(n.id);
      });
    }
    execution.status = 'completed';
    return { replies: orderReplies(workflow, replies, upstream), execution, writes: stateRun.finish() };
  } catch (cause) {
    execution.status = 'error';
    throw new ExecutionFailure(
      cause instanceof Error ? cause.message : String(cause),
      execution,
      orderReplies(workflow, replies, upstream),
      cause instanceof NodeExecutionError ? cause.nodeId : undefined,
      cause instanceof NodeExecutionError ? cause.nodeType : undefined,
      stateRun.finish(),
    );
  } finally {
    if (!replies.size && workflow.nodes.some((node) => node.type === 'chat-output'))
      execution.warnings.push('No Chat Output nodes ran; this turn produced no assistant messages.');
    for (const [nodeId, node] of Object.entries(execution.nodes))
      node.name = nodeDisplayName(workflow.nodes, labelOf, nodeId);
    execution.finishedAt = new Date().toISOString();
    emit({ type: 'execution:complete', detail: execution.status });
    options.signal?.removeEventListener('abort', onAbort);
  }
}
