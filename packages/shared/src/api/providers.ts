import { z } from 'zod';
import { providerFieldsSchema, providerViewSchema } from '../provider.js';
import { endpoint, noContentSchema } from './common.js';

// Not `idParamsSchema`: the built-in provider's id is `openrouter`, not a UUID.
const providerParamsSchema = z.object({ id: z.string().min(1) });

export const providerEndpoints = {
  // The built-in providers first, then the user's.
  listProviders: endpoint(z.array(providerViewSchema)),
  getProvider: endpoint(providerViewSchema, undefined, providerParamsSchema),
  createProvider: endpoint(providerViewSchema, providerFieldsSchema),
  // Built-in providers answer 409 `PROVIDER_READ_ONLY` to updates and deletes.
  updateProvider: endpoint(providerViewSchema, providerFieldsSchema, providerParamsSchema),
  deleteProvider: endpoint(noContentSchema, undefined, providerParamsSchema),
  // Copies any provider (the built-in one included) into a new editable record.
  duplicateProvider: endpoint(providerViewSchema, undefined, providerParamsSchema),
};
