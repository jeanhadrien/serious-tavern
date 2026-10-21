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
  listProviders: endpoint(
    {
      method: 'GET',
      path: '/api/providers',
      description: "List the LLM providers: built-in ones first, then the user's. Secrets are never included.",
    },
    z.array(providerViewSchema),
  ),
  getProvider: endpoint(
    { method: 'GET', path: '/api/providers/:id', description: 'Get one LLM provider.' },
    providerViewSchema,
    undefined,
    providerParamsSchema,
  ),
  createProvider: endpoint({ method: 'POST', path: '/api/providers' }, providerViewSchema, providerFieldsSchema),
  // Built-in providers answer 409 `PROVIDER_READ_ONLY` to updates and deletes.
  updateProvider: endpoint(
    { method: 'PUT', path: '/api/providers/:id' },
    providerViewSchema,
    providerFieldsSchema,
    providerParamsSchema,
  ),
  deleteProvider: endpoint(
    { method: 'DELETE', path: '/api/providers/:id' },
    noContentSchema,
    undefined,
    providerParamsSchema,
  ),
  // Copies any provider (the built-in one included) into a new editable record.
  duplicateProvider: endpoint(
    { method: 'POST', path: '/api/providers/:id/duplicate' },
    providerViewSchema,
    undefined,
    providerParamsSchema,
  ),
  // The models the provider's backend serves (`GET <baseUrl>/models`), cached in server memory. `400
  // PROVIDER_SECRET_MISSING` when the record names a secret that is not set, `502 PROVIDER_MODELS_FAILED` when the backend fails.
  listProviderModels: endpoint(
    {
      method: 'GET',
      path: '/api/providers/:id/models',
      description:
        'List the models a provider offers (cached; refresh=true re-fetches). Fails with 400 PROVIDER_SECRET_MISSING when its API key is not set.',
    },
    providerModelListSchema,
    undefined,
    providerParamsSchema,
    providerModelsQuerySchema,
  ),
};
