import type { CollectionItem, StateSnapshot, StateWrite } from '@st/shared';
import { resolveWrites, type BufferedRequest, type Committed } from './state-resolve.js';
import type { StateWriteRequest } from './types.js';

type NodeRequests = { requests: BufferedRequest[]; adds: number; wave?: number };

// Plain code-unit order, like `orderOutputs`, so the result never depends on the locale.
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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
    return resolveWrites(committed, this.snapshot);
  }

  private node(nodeId: string): NodeRequests {
    const found = this.nodes.get(nodeId) ?? { requests: [], adds: 0 };
    this.nodes.set(nodeId, found);
    return found;
  }
}
