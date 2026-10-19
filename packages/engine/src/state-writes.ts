import { byText, type CollectionItem, type ExecutionLog, type StateSnapshot, type StateWrite } from '@st/shared';
import { createStateAccess, frozenStateValues } from './state-access.js';
import { resolveWrites, type BufferedRequest, type Committed } from './state-resolve.js';
import type { ExecutionContext, StateAccess, StateWriteRequest } from './types.js';

type NodeRequests = { requests: BufferedRequest[]; adds: number; wave?: number };

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
  ) {}

  /**
   * The `writeState` function of one node. `add` mints the item id (`<execution>:<node>:<n>`, n counting the
   * node's adds from 1), so ids are unique across nodes and runs and never depend on call timing, and
   * returns the item as it will be stored. Calls after the node committed are ignored.
   */
  writer(nodeId: string): (request: StateWriteRequest) => { item?: CollectionItem } {
    return (request) => {
      const node = this.node(nodeId);
      if (node.wave !== undefined) return {};
      if (request.op !== 'add') {
        node.requests.push(structuredClone(request));
        return {};
      }
      const item = { ...structuredClone(request.item), id: `${this.executionId}:${nodeId}:${++node.adds}` };
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
  ) {
    this.buffer = new StateWriteBuffer(snapshot, execution.id, workflowId);
    this.values = frozenStateValues(snapshot);
  }

  /** What `trigger.turn` adds to the context's trigger: only when the caller tracks story state. */
  get trigger(): { turn?: number } {
    return this.snapshot ? { turn: this.snapshot.turn } : {};
  }

  /** `state` and `writeState` for one node. `isActive` tells whether it is still running: later calls are ignored. */
  context(nodeId: string, isActive: () => boolean): Pick<ExecutionContext, 'state' | 'writeState'> {
    const write = this.buffer.writer(nodeId);
    return {
      state: createStateAccess(this.snapshot, nodeId, this.values),
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
