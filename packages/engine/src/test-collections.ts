import {
  collectionEntrySchema,
  type Collection,
  type CollectionEntry,
  type Edge,
  type StateSnapshot,
  type Workflow,
} from '@st/shared';
import { createStateAccess } from './state-access.js';
import { StateWriteBuffer } from './state-writes.js';
import type { ExecutionContext, NodeDefinition, NodeResources } from './types.js';

// Fixtures shared by the Recall and Draw tests.

export const collection = (
  id: string,
  entries: Array<Partial<CollectionEntry> & { text: string }>,
  name = id,
): Collection => ({
  id,
  name,
  entries: entries.map((entry) => collectionEntrySchema.parse(entry)),
  createdAt: '',
  updatedAt: '',
});

export const resourcesWith = (...collections: Collection[]): NodeResources => ({
  presets: { get: async () => undefined },
  collections: { get: async (id) => collections.find((item) => item.id === id) },
});

/** Runs a node directly on a parsed config. `draws` scripts `ctx.random()`; without them it always returns 0. */
export async function runNode(
  definition: NodeDefinition,
  config: Record<string, unknown>,
  options: {
    resources: NodeResources;
    inputs?: Record<string, unknown>;
    message?: string;
    history?: ExecutionContext['history'];
    draws?: number[];
    // The story state the node runs against; its writes come back resolved, as the executor would store them.
    state?: StateSnapshot;
  },
) {
  const logs: string[] = [];
  const queue = options.draws ? [...options.draws] : undefined;
  let drawn = 0;
  const writes = new StateWriteBuffer(options.state, 'run');
  const state = createStateAccess(options.state, definition.type);
  const ctx: ExecutionContext = {
    nodeId: definition.type,
    inputs: options.inputs ?? {},
    config: definition.configSchema.parse(config),
    trigger: { message: options.message ?? '', sessionId: 's' },
    settings: {},
    history: options.history ?? [],
    replies: [],
    secrets: { get: async () => undefined },
    resources: options.resources,
    signal: new AbortController().signal,
    log: (line) => logs.push(line),
    state,
    pendingState: () => state,
    writeState: writes.writer(definition.type),
    random: () => {
      drawn++;
      if (!queue) return 0;
      if (!queue.length) throw new Error('drew more than scripted');
      return queue.shift()!;
    },
    recordWire: () => {},
    beginWire: () => {},
    emit: () => {},
  };
  const output = await definition.execute(ctx);
  writes.commit(definition.type, 1);
  return { output, logs, drawn, ...writes.resolve() };
}

export const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});

export const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

export const graph = (nodes: Workflow['nodes'], edges: Edge[]): Workflow => ({
  id: 'w',
  name: 'W',
  nodes,
  edges,
  createdAt: '',
  updatedAt: '',
});
