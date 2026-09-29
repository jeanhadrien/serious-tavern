import { z } from 'zod';
import { workflowSchema } from '../models.js';
import { endpoint, idParamsSchema, noContentSchema } from './common.js';

export const workflowEndpoints = {
  listWorkflows: endpoint(z.array(workflowSchema)),
  createWorkflow: endpoint(workflowSchema, z.object({ name: z.string().trim().min(1) })),
  getWorkflow: endpoint(workflowSchema, undefined, idParamsSchema),
  updateWorkflow: endpoint(
    workflowSchema,
    workflowSchema.pick({ name: true, nodes: true, edges: true }),
    idParamsSchema,
  ),
  deleteWorkflow: endpoint(noContentSchema, undefined, idParamsSchema),
  validateWorkflow: endpoint(
    z.object({ valid: z.literal(true), errors: z.array(z.string()) }),
    undefined,
    idParamsSchema,
  ),
};
