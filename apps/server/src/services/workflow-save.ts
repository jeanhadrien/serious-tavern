import { pruneInvalidEdges, validateWorkflow, type NodeResources } from '@st/engine';
import { layoutNodes, type NodeDraft, type ValidationIssue, type Workflow, type WorkflowDraft } from '@st/shared';

/** What a workflow save tells the client: the edges it dropped and the problems the stored workflow still has. */
export type WorkflowSaveReport = { droppedEdgeIds: string[]; issues: ValidationIssue[] };

/** Drops the report fields from a client body, so an echoed save response never reaches the stored record. */
export function withoutSaveReport<T extends object>(fields: T): T {
  const { droppedEdgeIds: _dropped, issues: _issues, ...rest } = fields as T & Partial<WorkflowSaveReport>;
  return rest as T;
}

/** A node written without a position keeps the one it has in the stored workflow, so a terse update does not rearrange it. */
export function withStoredPositions(nodes: NodeDraft[], stored: Workflow['nodes']): NodeDraft[] {
  const positions = new Map(stored.map((node) => [node.id, node.position]));
  return nodes.map((node) =>
    node.position || !positions.has(node.id) ? node : { ...node, position: positions.get(node.id) },
  );
}

/**
 * Prepares a workflow for storage, the one path of create and update: edges to ports that no longer exist are
 * dropped, nodes without a position are laid out along the remaining edges, then the result is validated.
 * Validation only reports: a draft may legitimately be incomplete, so an invalid workflow is still saved.
 */
export async function checkWorkflowForSave(
  draft: WorkflowDraft,
  resources: NodeResources,
): Promise<{ workflow: Workflow; report: WorkflowSaveReport }> {
  const pruned = await pruneInvalidEdges(draft, resources);
  const kept = new Set(pruned.edges);
  const droppedEdgeIds = draft.edges.filter((edge) => !kept.has(edge)).map((edge) => edge.id);
  const workflow = { ...pruned, nodes: layoutNodes(pruned.nodes, pruned.edges) };
  return { workflow, report: { droppedEdgeIds, issues: await validateWorkflow(workflow, resources) } };
}
