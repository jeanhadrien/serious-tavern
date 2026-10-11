import type { PreparedWorkflow } from '@st/engine';

/**
 * Chat Outputs whose reply is exactly one LLM's text: no template, and the only edge into `value`
 * comes from an LLM `text` port. Maps Chat Output node id to LLM node id. Only these outputs are
 * streamed live; every other output is written once, when the turn settles.
 */
export function passthroughSources(prepared: PreparedWorkflow): Map<string, string> {
  const sources = new Map<string, string>();
  for (const output of prepared.workflow.nodes) {
    if (output.type !== 'chat-output' || output.config.template) continue;
    const feeds = (prepared.incoming.get(output.id) ?? []).filter((edge) => edge.targetHandle === 'value');
    const edge = feeds.length === 1 ? feeds[0] : undefined;
    if (edge?.sourceHandle !== 'text') continue;
    const source = prepared.workflow.nodes.find((node) => node.id === edge.source);
    if (source?.type === 'llm') sources.set(output.id, source.id);
  }
  return sources;
}

/**
 * Reservation order for the reachable Chat Outputs: dependency order first, then the `order`
 * config, then node id. This is the same rule the engine applies to replies. Streamed rows use it
 * to pick their array position while the turn runs; the settled turn uses the engine's order.
 */
export function replyRanks(prepared: PreparedWorkflow): Map<string, number> {
  const { workflow, upstream, reachable } = prepared;
  const outputs = workflow.nodes.filter((node) => node.type === 'chat-output' && reachable.has(node.id));
  const ancestors = new Map(outputs.map((output) => [output.id, ancestorsOf(upstream, output.id)]));
  const remaining = new Set(outputs.map((output) => output.id));
  const ranks = new Map<string, number>();
  while (remaining.size) {
    const next = outputs
      .filter((output) => remaining.has(output.id) && ![...remaining].some((id) => ancestors.get(output.id)!.has(id)))
      .sort(
        (a, b) => Number(a.config.order ?? 0) - Number(b.config.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0];
    if (!next) break;
    ranks.set(next.id, ranks.size);
    remaining.delete(next.id);
  }
  return ranks;
}

function ancestorsOf(upstream: Map<string, string[]>, id: string): Set<string> {
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
