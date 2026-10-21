import { pruneInvalidEdges, validateWorkflow, type NodeResources } from '@st/engine';
import type { ValidationIssue, Workflow } from '@st/shared';

/** What a workflow save tells the client: the edges it dropped and the problems the stored workflow still has. */
export type WorkflowSaveReport = { droppedEdgeIds: string[]; issues: ValidationIssue[] };

/** Drops the report fields from a client body, so an echoed save response never reaches the stored record. */
export function withoutSaveReport<T extends object>(fields: T): Omit<T, keyof WorkflowSaveReport> {
  const { droppedEdgeIds: _dropped, issues: _issues, ...rest } = fields as T & Partial<WorkflowSaveReport>;
  return rest;
}

/**
 * Prepares a workflow for storage, the one path of create and update: edges to ports that no longer exist are
 * dropped, then what is left is validated. Validation only reports: a draft may legitimately be incomplete, so an
 * invalid workflow is still saved.
 */
export async function checkWorkflowForSave(
  workflow: Workflow,
  resources: NodeResources,
): Promise<{ workflow: Workflow; report: WorkflowSaveReport }> {
  const pruned = await pruneInvalidEdges(workflow, resources);
  const kept = new Set(pruned.edges);
  const droppedEdgeIds = workflow.edges.filter((edge) => !kept.has(edge)).map((edge) => edge.id);
  return { workflow: pruned, report: { droppedEdgeIds, issues: await validateWorkflow(pruned, resources) } };
}
