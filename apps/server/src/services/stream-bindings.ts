import { orderOutputs, type PreparedWorkflow } from '@st/engine';

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
 * Array position of each reachable Chat Output. Uses the engine's ordering, so streamed rows land
 * exactly where the settled turn will put them.
 */
export function replyRanks(prepared: PreparedWorkflow): Map<string, number> {
  const { workflow, upstream, reachable } = prepared;
  const order = orderOutputs(workflow, upstream, reachable);
  return new Map(order.map((id, rank) => [id, rank]));
}
