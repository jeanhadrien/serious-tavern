import { z } from 'zod';
import { validationIssueSchema, workflowDraftSchema, workflowSchema } from '../models.js';
import { endpoint, idParamsSchema, noContentSchema } from './common.js';

export const workflowInvalidDetailsSchema = z.object({
  workflowId: z.string(),
  workflowName: z.string(),
  issues: z.array(validationIssueSchema),
});
export type WorkflowInvalidDetails = z.infer<typeof workflowInvalidDetailsSchema>;

/**
 * The answer to a workflow create or update: the stored workflow plus what the save found. Both fields describe this
 * save only and are never stored, so a client echoing the record back is harmless (the server drops them).
 */
export const savedWorkflowSchema = workflowSchema.extend({
  droppedEdgeIds: z.array(z.string()),
  issues: z.array(validationIssueSchema),
});
export type SavedWorkflow = z.infer<typeof savedWorkflowSchema>;

export const workflowEndpoints = {
  listWorkflows: endpoint(
    {
      method: 'GET',
      path: '/api/workflows',
      description: 'List all workflows.',
    },
    z.array(workflowSchema),
  ),
  createWorkflow: endpoint(
    {
      method: 'POST',
      path: '/api/workflows',
      description:
        'Create a workflow. Node and edge ids are chosen by the caller and must be unique within the workflow. A node may omit position: the server lays out the nodes that have none, left to right along the edges. Edges to ports that do not exist are not stored: their ids come back in droppedEdgeIds. The workflow is saved even when invalid (a draft may be incomplete); issues lists what still prevents it from running (each may name edgeId and nodeIds).',
    },
    savedWorkflowSchema,
    // `nodes`/`edges`/`settings`/`notes` let a client create a copy of an existing workflow in one write.
    z
      .object({ name: z.string().trim().min(1) })
      .and(workflowDraftSchema.pick({ nodes: true, edges: true, settings: true, notes: true }).partial()),
  ),
  getWorkflow: endpoint(
    { method: 'GET', path: '/api/workflows/:id', description: 'Get one workflow: its nodes, edges and chat settings.' },
    workflowSchema,
    undefined,
    idParamsSchema,
  ),
  updateWorkflow: endpoint(
    {
      method: 'PUT',
      path: '/api/workflows/:id',
      description:
        'Replace a workflow with the given one (settings and notes are kept when omitted). A node may omit position: it keeps the position it has in the stored workflow, or else the server lays it out left to right along the edges. Edges to ports that do not exist are not stored: their ids come back in droppedEdgeIds. The workflow is saved even when invalid (a draft may be incomplete); issues lists what still prevents it from running (each may name edgeId and nodeIds).',
    },
    savedWorkflowSchema,
    // An omitted `settings` or `notes` keeps the stored ones.
    workflowDraftSchema.pick({ name: true, nodes: true, edges: true, settings: true, notes: true }),
    idParamsSchema,
  ),
  deleteWorkflow: endpoint(
    {
      method: 'DELETE',
      path: '/api/workflows/:id',
      description: 'Delete a workflow. Refused with 409 WORKFLOW_IN_USE while a chat replies with it.',
    },
    noContentSchema,
    undefined,
    idParamsSchema,
  ),
  validateWorkflow: endpoint(
    {
      method: 'POST',
      path: '/api/workflows/:id/validate',
      description:
        'Check that a stored workflow can run. Answers 422 WORKFLOW_INVALID with the list of issues (each may name edgeId and nodeIds).',
    },
    z.object({ valid: z.literal(true), errors: z.array(validationIssueSchema) }),
    undefined,
    idParamsSchema,
  ),
  validateWorkflowDraft: endpoint(
    {
      method: 'POST',
      path: '/api/workflows/validate',
      description:
        'Check a workflow that is not saved (what the editor holds): answers 200 with its issues, an empty list when it can run. Writes nothing.',
    },
    z.object({ issues: z.array(validationIssueSchema) }),
    workflowSchema.pick({ nodes: true, edges: true, settings: true }),
  ),
};
