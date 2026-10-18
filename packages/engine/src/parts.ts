import type { ValidationIssue, Workflow } from '@st/shared';
import { AFTER_REPLY_TYPE } from './nodes/after-reply/index.js';
import { upstreamOf } from './replies.js';
import type { NodeDefinition } from './types.js';

/**
 * The two runs a workflow's turn is made of. A sink (a node that must run: Chat Output, State Write) is a
 * **post-turn sink** when an After Reply node is among its upstream nodes; every other sink, Chat Output
 * included, is a reply sink. Each part holds its sinks and everything they depend on, so a node needed by both
 * sits in both sets and runs in both runs.
 */
export type WorkflowParts = {
  /** Reply sinks and everything they depend on: what runs while the reply is produced. */
  reply: ReadonlySet<string>;
  /** Post-turn sinks and everything they depend on (the After Reply nodes included): the after-reply run. */
  post: ReadonlySet<string>;
  /** The post-turn sinks in workflow order; empty means the workflow has no after-reply run. */
  postSinks: readonly string[];
};

/** The seed of a turn's after-reply run, so its rolls differ from the reply run's but come from the same turn seed. */
export const postRunSeed = (turnSeed: string): string => `${turnSeed}:post`;

/**
 * Splits the sinks of a workflow into the reply part and the post part, and reports the sinks that cannot be in
 * the post part: a Chat Output that depends on After Reply could only be written after the reply is. Safe on
 * cyclic graphs (it runs before the cycle is reported).
 */
export function partitionWorkflow(
  workflow: Workflow,
  definitions: ReadonlyMap<string, NodeDefinition>,
  upstream: ReadonlyMap<string, string[]>,
  nameOf: (id: string) => string,
): { parts: WorkflowParts; issues: ValidationIssue[] } {
  const reply = new Set<string>();
  const post = new Set<string>();
  const postSinks: string[] = [];
  const issues: ValidationIssue[] = [];
  for (const node of workflow.nodes) {
    if (!definitions.get(node.id)?.sink) continue;
    const needed = upstreamOf(upstream, node.id);
    const afterReply = workflow.nodes.find((item) => item.type === AFTER_REPLY_TYPE && needed.has(item.id));
    const part = afterReply ? post : reply;
    part.add(node.id);
    for (const id of needed) part.add(id);
    if (!afterReply) continue;
    postSinks.push(node.id);
    if (node.type === 'chat-output')
      issues.push({
        message: `"${nameOf(node.id)}" can't depend on "${nameOf(afterReply.id)}": replies are written before it runs.`,
        nodeIds: [node.id, afterReply.id],
      });
  }
  return { parts: { reply, post, postSinks }, issues };
}

/**
 * The nodes a run of `part` does not run that its log still lists as skipped, with the detail for each. The
 * reply log lists every node it does not run; the post log lists none, so it only shows the after-reply work.
 */
export function skippedNodes(
  parts: WorkflowParts,
  part: 'reply' | 'post',
  workflow: Workflow,
): { nodeId: string; detail: string }[] {
  if (part === 'post') return [];
  return workflow.nodes
    .filter((node) => !parts.reply.has(node.id))
    .map((node) => ({
      nodeId: node.id,
      detail: parts.post.has(node.id) ? 'runs after the reply' : 'not needed by any output',
    }));
}
