import type { Workflow } from '@st/shared';
import type { ChatReply } from './types.js';

export function orderReplies(
  workflow: Workflow,
  replies: Map<string, ChatReply>,
  upstream: Map<string, string[]>,
): ChatReply[] {
  const outputs = workflow.nodes.filter((node) => node.type === 'chat-output' && replies.has(node.id));
  const ancestors = new Map<string, Set<string>>();
  for (const output of outputs) {
    const seen = new Set<string>();
    const visit = [...(upstream.get(output.id) ?? [])];
    while (visit.length) {
      const id = visit.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      visit.push(...(upstream.get(id) ?? []));
    }
    ancestors.set(output.id, seen);
  }
  const remaining = new Set(outputs.map((node) => node.id));
  const result: ChatReply[] = [];
  while (remaining.size) {
    // Prioritize only dependency-ready outputs, never completion timestamps.
    const next = outputs
      .filter((node) => remaining.has(node.id) && ![...remaining].some((id) => ancestors.get(node.id)!.has(id)))
      .sort(
        (a, b) => Number(a.config.order ?? 0) - Number(b.config.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0]!;
    remaining.delete(next.id);
    const reply = replies.get(next.id);
    if (reply) result.push(reply);
  }
  return result;
}
