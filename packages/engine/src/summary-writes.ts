import { byText, type ExecutionLog, type Summary, type SummaryWrite } from '@st/shared';
import type { RepeatedNodes } from './state-writes.js';
import type { ExecutionContext, SummaryWriteRequest } from './types.js';

type NodeRequests = { requests: SummaryWriteRequest[]; wave?: number };

/**
 * The history summaries of one run: the frozen snapshot nodes read and the summaries they ask to store. Follows the
 * rules of `StateRun`: nothing counts until the node that asked has completed (`commit`), so a node that errors or is
 * cancelled stores nothing; `finish` resolves the committed requests in a fixed order (wave, node id, call order)
 * that does not depend on which node finished first; and the after-reply run drops the writes of nodes the reply run
 * also ran (`repeated`), with a warning. Where the writes go (and whether they still fit the chat) is the caller's.
 */
export class SummaryRun {
  private readonly nodes = new Map<string, NodeRequests>();
  private readonly snapshot: Readonly<Record<string, readonly Summary[]>>;

  constructor(
    summaries: Readonly<Record<string, readonly Summary[]>> | undefined,
    private readonly execution: Pick<ExecutionLog, 'id' | 'warnings'>,
    private readonly repeated?: RepeatedNodes,
  ) {
    this.snapshot = Object.freeze(structuredClone(summaries ?? {}));
  }

  /** `summaries` and `writeSummary` for one node. `isActive` tells whether it is still running: later calls are ignored. */
  context(nodeId: string, isActive: () => boolean): Pick<ExecutionContext, 'summaries' | 'writeSummary'> {
    return {
      summaries: this.snapshot,
      writeSummary: (request) => {
        const node = this.node(nodeId);
        const id = `${this.execution.id}:${nodeId}:${node.requests.length + 1}`;
        if (isActive() && node.wave === undefined) node.requests.push(structuredClone(request));
        return { id };
      },
    };
  }

  /** The node completed in `wave`: its writes count now, unless the reply run already ran it. */
  commit(nodeId: string, wave: number): void {
    const node = this.node(nodeId);
    node.wave ??= wave;
    if (!this.repeated?.ids.has(nodeId) || !node.requests.length) return;
    node.requests = [];
    this.execution.warnings.push(
      `"${this.repeated.nameOf(nodeId)}" also ran in the reply run, so its summary writes were not repeated in this run.`,
    );
  }

  /** The writes of the nodes that completed. A fresh array each time; never throws. */
  finish(): SummaryWrite[] {
    return [...this.nodes]
      .flatMap(([nodeId, { requests, wave }]) =>
        wave === undefined ? [] : requests.map((request, index) => ({ nodeId, wave, request, index })),
      )
      .sort((a, b) => a.wave - b.wave || byText(a.nodeId, b.nodeId) || a.index - b.index)
      .map(({ nodeId, request, index }) => ({
        ...structuredClone(request),
        id: `${this.execution.id}:${nodeId}:${index + 1}`,
        nodeId,
      }));
  }

  private node(nodeId: string): NodeRequests {
    const found = this.nodes.get(nodeId) ?? { requests: [] };
    this.nodes.set(nodeId, found);
    return found;
  }
}
