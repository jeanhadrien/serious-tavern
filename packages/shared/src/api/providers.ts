import { z } from 'zod';
import { providerFieldsSchema, providerViewSchema } from '../provider.js';
import { providerModelListSchema } from '../provider-models.js';
import { endpoint, noContentSchema } from './common.js';

// Not `idParamsSchema`: the built-in provider's id is `openrouter`, not a UUID.
const providerParamsSchema = z.object({ id: z.string().min(1) });

// `refresh=true` bypasses the server's cached list.
export const providerModelsQuerySchema = z.object({ refresh: z.enum(['true', 'false']).optional() });

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
  // The models the provider's backend serves (`GET <baseUrl>/models`), cached in server memory. `400
  // PROVIDER_SECRET_MISSING` when the record names a secret that is not set, `502 PROVIDER_MODELS_FAILED` when the backend fails.
  listProviderModels: endpoint(providerModelListSchema, undefined, providerParamsSchema, providerModelsQuerySchema),
};
