import { z } from 'zod';
import { nodeTypeDescriptorSchema, portSchema } from '../models.js';
import { endpoint, noContentSchema } from './common.js';

export const secretSummarySchema = z.object({ name: z.string(), hint: z.string() });
const secretNameSchema = z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]+$/) });
export const catalogEndpoints = {
  listNodeTypes: endpoint(z.array(nodeTypeDescriptorSchema)),
  resolvePorts: endpoint(
    z.object({ inputs: z.array(portSchema), outputs: z.array(portSchema) }),
    z.object({ config: z.record(z.string(), z.unknown()) }),
    z.object({ type: z.string() }),
  ),
  listSecrets: endpoint(z.array(secretSummarySchema)),
  setSecret: endpoint(noContentSchema, z.object({ value: z.string().min(1) }), secretNameSchema),
  deleteSecret: endpoint(noContentSchema, undefined, secretNameSchema),
};
export type SecretSummary = z.infer<typeof secretSummarySchema>;
