import { z } from 'zod';
import { nodeTypeDescriptorSchema, portSchema } from '../models.js';
import { endpoint, noContentSchema } from './common.js';

export const secretSummarySchema = z.object({ name: z.string(), hint: z.string() });
const secretNameSchema = z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]+$/) });
export const catalogEndpoints = {
  listNodeTypes: endpoint(
    {
      method: 'GET',
      path: '/api/node-types',
      description: 'List every node type with its ports, config schema and defaults.',
    },
    z.array(nodeTypeDescriptorSchema),
  ),
  resolvePorts: endpoint(
    {
      method: 'POST',
      path: '/api/node-types/:type/ports',
      description:
        'Resolve the input and output ports of a node of this type for the given config (needed for types with dynamic ports).',
    },
    z.object({ inputs: z.array(portSchema), outputs: z.array(portSchema) }),
    z.object({ config: z.record(z.string(), z.unknown()) }),
    z.object({ type: z.string() }),
  ),
  listSecrets: endpoint({ method: 'GET', path: '/api/secrets' }, z.array(secretSummarySchema)),
  setSecret: endpoint(
    { method: 'PUT', path: '/api/secrets/:name' },
    noContentSchema,
    z.object({ value: z.string().min(1) }),
    secretNameSchema,
  ),
  deleteSecret: endpoint(
    { method: 'DELETE', path: '/api/secrets/:name' },
    noContentSchema,
    undefined,
    secretNameSchema,
  ),
};
export type SecretSummary = z.infer<typeof secretSummarySchema>;
