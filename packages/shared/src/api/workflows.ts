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
    // `nodes`/`edges` let a client create a copy of an existing graph in one write.
    z.object({ name: z.string().trim().min(1) }).and(workflowSchema.pick({ nodes: true, edges: true }).partial()),
  ),
  getWorkflow: endpoint(workflowSchema, undefined, idParamsSchema),
  updateWorkflow: endpoint(
    workflowSchema,
    workflowSchema.pick({ name: true, nodes: true, edges: true }),
    idParamsSchema,
  ),
  deleteWorkflow: endpoint(noContentSchema, undefined, idParamsSchema),
  validateWorkflow: endpoint(
    z.object({ valid: z.literal(true), errors: z.array(validationIssueSchema) }),
    undefined,
    idParamsSchema,
  ),
};
