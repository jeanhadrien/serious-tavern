import type { Workflow } from '@st/shared';
import type { ChatReply } from './types.js';

/** Transitive upstream of a node (the node itself excluded). */
export function upstreamOf(upstream: ReadonlyMap<string, string[]>, id: string): Set<string> {
  const seen = new Set<string>();
  const visit = [...(upstream.get(id) ?? [])];
  while (visit.length) {
    const next = visit.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    visit.push(...(upstream.get(next) ?? []));
  }
  return seen;
}

function isStrictSubset(small: Set<string>, big: Set<string>): boolean {
  return small.size < big.size && [...small].every((id) => big.has(id));
}

/**
 * Final message order of the given Chat Output nodes. This is the single source of truth for both the
 * settled turn and the row positions of streamed replies.
 *
 * Output Y must come before output X when Y's upstream node set is a strict subset of X's (this covers
 * "Y feeds X", and also outputs fed by a shared upstream node). Among outputs with no remaining
 * predecessor, the lowest `order` config wins, then the lowest node id. Finish times and canvas
 * positions never matter.
 */
export function orderOutputs(workflow: Workflow, upstream: Map<string, string[]>, outputIds: Set<string>): string[] {
  const outputs = workflow.nodes.filter((node) => node.type === 'chat-output' && outputIds.has(node.id));
  const upstreams = new Map(outputs.map((output) => [output.id, upstreamOf(upstream, output.id)]));
  const remaining = new Set(outputs.map((output) => output.id));
  const result: string[] = [];
  while (remaining.size) {
    const next = outputs
      .filter(
        (output) =>
          remaining.has(output.id) &&
          ![...remaining].some((id) => isStrictSubset(upstreams.get(id)!, upstreams.get(output.id)!)),
      )
      .sort(
        (a, b) => Number(a.config.order ?? 0) - Number(b.config.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0]!;
    remaining.delete(next.id);
    result.push(next.id);
  }
  return result;
}

/** Replies of the outputs that ran, in final message order. */
export function orderReplies(
  workflow: Workflow,
  replies: Map<string, ChatReply>,
  upstream: Map<string, string[]>,
): ChatReply[] {
  return orderOutputs(workflow, upstream, new Set(replies.keys())).map((id) => replies.get(id)!);
}
