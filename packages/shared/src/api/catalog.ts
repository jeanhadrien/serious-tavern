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
      description:
        'List every node type with its ports, config schema and defaults. The answer is large (tens of kilobytes): to learn one type, call getNodeType.',
    },
    z.array(nodeTypeDescriptorSchema),
  ),
  getNodeType: endpoint(
    {
      method: 'GET',
      path: '/api/node-types/:type',
      description:
        'Get one node type: what it does, its fixed input and output ports, the JSON Schema of its config, its default config and which config fields are templates. Types with dynamicPorts have ports that depend on the node config: resolvePorts answers for a given config. 404 for an unknown type.',
    },
    nodeTypeDescriptorSchema,
    undefined,
    z.object({ type: z.string() }),
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
