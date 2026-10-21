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
  listWorkflows: endpoint(z.array(workflowSchema)),
  createWorkflow: endpoint(
    workflowSchema,
    // `nodes`/`edges`/`settings` let a client create a copy of an existing workflow in one write.
    z
      .object({ name: z.string().trim().min(1) })
      .and(workflowSchema.pick({ nodes: true, edges: true, settings: true }).partial()),
  ),
  getWorkflow: endpoint(workflowSchema, undefined, idParamsSchema),
  updateWorkflow: endpoint(
    workflowSchema,
    // An omitted `settings` keeps the stored declarations.
    workflowSchema.pick({ name: true, nodes: true, edges: true, settings: true }),
    idParamsSchema,
  ),
  deleteWorkflow: endpoint(noContentSchema, undefined, idParamsSchema),
  validateWorkflow: endpoint(
    z.object({ valid: z.literal(true), errors: z.array(validationIssueSchema) }),
    undefined,
    idParamsSchema,
  ),
  // Validates a draft the editor holds, without saving it. Problems are the expected answer (200), not a failure.
  validateWorkflowDraft: endpoint(
    z.object({ issues: z.array(validationIssueSchema) }),
    workflowSchema.pick({ nodes: true, edges: true, settings: true }),
  ),
};
