import { z } from 'zod';
import { validationIssueSchema, workflowSchema } from '../models.js';
import { endpoint, idParamsSchema, noContentSchema } from './common.js';

export const workflowInvalidDetailsSchema = z.object({
  workflowId: z.string(),
  workflowName: z.string(),
  issues: z.array(validationIssueSchema),
});
export type WorkflowInvalidDetails = z.infer<typeof workflowInvalidDetailsSchema>;

export const workflowEndpoints = {
  listWorkflows: endpoint(
    {
      method: 'GET',
      path: '/api/workflows',
      description: 'List all workflows (full records, nodes and edges included).',
    },
    z.array(workflowSchema),
  ),
  createWorkflow: endpoint(
    {
      method: 'POST',
      path: '/api/workflows',
      description:
        'Create a workflow. Node and edge ids are chosen by the caller and must be unique within the workflow. The result is not validated: call validateWorkflow.',
    },
    workflowSchema,
    // `nodes`/`edges`/`settings` let a client create a copy of an existing workflow in one write.
    z
      .object({ name: z.string().trim().min(1) })
      .and(workflowSchema.pick({ nodes: true, edges: true, settings: true }).partial()),
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
        'Replace a workflow with the given one (settings are kept when omitted). Edges to ports that no longer exist are dropped. Not validated: call validateWorkflow.',
    },
    workflowSchema,
    // An omitted `settings` keeps the stored declarations.
    workflowSchema.pick({ name: true, nodes: true, edges: true, settings: true }),
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
};
