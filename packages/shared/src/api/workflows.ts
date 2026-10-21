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
    // `nodes`/`edges`/`settings`/`notes` let a client create a copy of an existing workflow in one write.
    z
      .object({ name: z.string().trim().min(1) })
      .and(workflowSchema.pick({ nodes: true, edges: true, settings: true, notes: true }).partial()),
  ),
  getWorkflow: endpoint(workflowSchema, undefined, idParamsSchema),
  updateWorkflow: endpoint(
    workflowSchema,
    // An omitted `settings` or `notes` keeps the stored ones.
    workflowSchema.pick({ name: true, nodes: true, edges: true, settings: true, notes: true }),
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
