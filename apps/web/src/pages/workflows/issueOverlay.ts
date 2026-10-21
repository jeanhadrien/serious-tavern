import type { Edge } from '@xyflow/react';
import type { ValidationIssue } from '@st/shared';

// What the canvas derives from the engine's issues at render. None of it is part of the draft: it never goes into node
// `data`, or an undo would bring back stale badges.

/** The issues the canvas list shows. Settings problems belong to the chat settings panel and its toolbar count. */
export const listedIssues = (issues: readonly ValidationIssue[]): ValidationIssue[] =>
  issues.filter((issue) => issue.source !== 'settings');

/** The messages of the issues that name each node, in the order they were reported. */
export function issuesByNode(issues: readonly ValidationIssue[]): Map<string, string[]> {
  const byNode = new Map<string, string[]>();
  for (const issue of issues)
    for (const id of new Set(issue.nodeIds)) byNode.set(id, [...(byNode.get(id) ?? []), issue.message]);
  return byNode;
}

/** The connections named by an issue. */
export const issueEdgeIds = (issues: readonly ValidationIssue[]): Set<string> =>
  new Set(issues.flatMap((issue) => (issue.edgeId ? [issue.edgeId] : [])));

/**
 * What clicking an issue selects: the nodes it names plus the ends of the connection it names (a connection to a
 * missing node names only one end), and the connection. Empty for an issue about the workflow as a whole.
 */
export function issueTargets(
  issue: ValidationIssue,
  edges: readonly Pick<Edge, 'id' | 'source' | 'target'>[],
): { nodeIds: string[]; edgeId?: string } {
  const edge = issue.edgeId === undefined ? undefined : edges.find((item) => item.id === issue.edgeId);
  const nodeIds = new Set([...(issue.nodeIds ?? []), ...(edge ? [edge.source, edge.target] : [])]);
  return { nodeIds: [...nodeIds], edgeId: edge?.id };
}
