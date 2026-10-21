import { byText, type CollectionItem, type ExecutionLog, type StateSnapshot, type StateWrite } from '@st/shared';
import { createStateAccess, frozenStateValues } from './state-access.js';
import { resolveWrites, type BufferedRequest, type Committed } from './state-resolve.js';
import type { ExecutionContext, StateAccess, StateWriteRequest } from './types.js';

type NodeRequests = {
  requests: BufferedRequest[];
  adds: number;
  wave?: number;
  // The pending view built for the requests so far (`StateRun.pendingView`); dropped by the node's next write.
  view?: StateSnapshot;
};

/**
 * Collects the state writes nodes ask for during a run. Nothing is visible to reads (the run reads its
 * start-of-turn snapshot), and nothing counts until the node that asked has completed (`commit`), so a node
 * that errors or is cancelled contributes nothing. `resolve` turns the committed requests into stored
 * writes in a fixed order that does not depend on which node finished first.
 */
export class StateWriteBuffer {
  private readonly nodes = new Map<string, NodeRequests>();

  constructor(
    private readonly snapshot: StateSnapshot | undefined,
    private readonly executionId: string,
    // The run's workflow: a node's own keys are stored under it (see `resolveWrites`).
    private readonly workflowId?: string,
    // The turn's id; a thread item without one is stamped with the run's own id (a run outside a turn is its own turn).
    private readonly turnId?: string,
  ) {}

  // What the engine stamps on an item added to a thread key, so the Thread node can place the exchange in the chat.
  private stamps(target: StateWriteRequest['target']): Record<string, string> {
    if (target.kind !== 'definition') return {};
    const definition = this.snapshot?.definitions.find((candidate) => candidate.id === target.definitionId);
    const def = definition && Object.hasOwn(definition.keys, target.key) ? definition.keys[target.key] : undefined;
    return def?.type === 'thread' ? { turnId: this.turnId ?? this.executionId, runId: this.executionId } : {};
  }

  /**
   * The `writeState` function of one node. `add` mints the item id (`<execution>:<node>:<n>`, n counting the
   * node's adds from 1), so ids are unique across nodes and runs and never depend on call timing, and
   * returns the item as it will be stored; an item of a thread key also gets its `turnId` and `runId`. Calls after the
   * node committed are ignored.
   */
  writer(nodeId: string): (request: StateWriteRequest) => { item?: CollectionItem } {
    return (request) => {
      const node = this.node(nodeId);
      if (node.wave !== undefined) return {};
      node.view = undefined;
      if (request.op !== 'add') {
        node.requests.push(structuredClone(request));
        return {};
      }
      const item = {
        ...structuredClone(request.item),
        ...this.stamps(request.target),
        id: `${this.executionId}:${nodeId}:${++node.adds}`,
      };
      node.requests.push({ ...request, item });
      return { item: structuredClone(item) };
    };
  }

  /** The node completed in `wave`: its requests now count. */
  commit(nodeId: string, wave: number): void {
    const node = this.node(nodeId);
    node.wave ??= wave;
  }

  /**
   * The stored writes of every committed node, in order: by wave, then node id, then call order. A fresh
   * array each time, so later calls (detached work that ignored an abort) cannot change one already returned.
   * Never throws.
   */
  resolve(): { writes: StateWrite[]; warnings: string[] } {
    const committed: Committed[] = [...this.nodes]
      .flatMap(([nodeId, { requests, wave }]) =>
        wave === undefined ? [] : requests.map((request) => ({ nodeId, wave, request })),
      )
      .sort((a, b) => a.wave - b.wave || byText(a.nodeId, b.nodeId));
    return resolveWrites(committed, this.snapshot, this.workflowId);
  }

  /**
   * The state as the run's fold gives it with this node's buffered requests applied, committed or not: they are
   * resolved on their own against the snapshot (other nodes' requests are not seen) and handed to `foldWith`. Cached
   * until the node's next write; the snapshot itself when the requests resolve to no write.
   */
  pendingView(nodeId: string, foldWith: (pending: StateWrite[]) => StateSnapshot): StateSnapshot | undefined {
    const node = this.node(nodeId);
    if (!node.view) {
      const requests = node.requests.map((request) => ({ nodeId, wave: 0, request }));
      // Resolver warnings are not collected: `resolve` reports them when the node's requests count.
      const { writes } = resolveWrites(requests, this.snapshot, this.workflowId);
      node.view = writes.length ? foldWith(writes) : this.snapshot;
    }
    return node.view;
  }

  private node(nodeId: string): NodeRequests {
    const found = this.nodes.get(nodeId) ?? { requests: [], adds: 0 };
    this.nodes.set(nodeId, found);
    return found;
  }
}

/**
 * The story state of one run: the frozen template values, the write buffer, and the state members each node's
 * context gets. Keeps `executeWorkflow` free of state plumbing.
 */
export class StateRun {
  private readonly buffer: StateWriteBuffer;
  private readonly values: StateAccess['values'];

  constructor(
    private readonly snapshot: StateSnapshot | undefined,
    private readonly execution: Pick<ExecutionLog, 'id' | 'warnings'>,
    workflowId: string,
    // Folds the run's story state with extra writes of the running turn (the caller's `foldWith`), if it gave one.
    private readonly foldWith?: (pending: StateWrite[]) => StateSnapshot,
    // The turn's id, stamped on thread items (see `StateWriteBuffer.writer`).
    private readonly turnId?: string,
  ) {
    this.buffer = new StateWriteBuffer(snapshot, execution.id, workflowId, turnId);
    this.values = frozenStateValues(snapshot);
  }

  /** What `trigger.turn` and `trigger.turnId` add to the context's trigger: the turn only when the caller tracks story state. */
  get trigger(): { turn?: number; turnId?: string } {
    return {
      ...(this.snapshot && { turn: this.snapshot.turn }),
      ...(this.turnId !== undefined && { turnId: this.turnId }),
    };
  }

  /**
   * The state with the writes `nodeId` has asked for so far folded in, as the caller's fold would read it: the run
   * snapshot when the node has written nothing, or when the caller gave no `foldWith`. Only the writing node gets it.
   */
  pendingView(nodeId: string): StateSnapshot | undefined {
    return this.foldWith ? this.buffer.pendingView(nodeId, this.foldWith) : this.snapshot;
  }

  /** `state`, `pendingState` and `writeState` for one node. `isActive` tells whether it is still running: later calls are ignored. */
  context(nodeId: string, isActive: () => boolean): Pick<ExecutionContext, 'state' | 'pendingState' | 'writeState'> {
    const write = this.buffer.writer(nodeId);
    let cached: { view: StateSnapshot | undefined; access: StateAccess } | undefined;
    return {
      state: createStateAccess(this.snapshot, nodeId, this.values),
      pendingState: () => {
        const view = this.pendingView(nodeId);
        if (!cached || cached.view !== view)
          cached = { view, access: createStateAccess(view, nodeId, view === this.snapshot ? this.values : undefined) };
        return cached.access;
      },
      writeState: (request) => (isActive() ? write(request) : {}),
    };
  }

  /** The node completed in `wave`: only now do its writes count. */
  commit(nodeId: string, wave: number): void {
    this.buffer.commit(nodeId, wave);
  }

  /** The stored writes of the nodes that completed; resolver warnings join the execution's. Call once per outcome. */
  finish(): StateWrite[] {
    const { writes, warnings } = this.buffer.resolve();
    this.execution.warnings.push(...warnings);
    return writes;
  }
}
