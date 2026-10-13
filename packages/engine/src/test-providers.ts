import { findBuiltInProvider, type Provider } from '@st/shared';
import { adapters, type LlmAdapter } from './providers/index.js';
import { openaiCompatible } from './providers/openai-compatible.js';

/** The built-in OpenRouter record. */
export const openrouterProvider = findBuiltInProvider('openrouter')!;

/** A user-style provider record whose id and secret tests can rely on. */
export const providerRecord = (id: string, overrides: Partial<Provider> = {}): Provider => ({
  ...openrouterProvider,
  id,
  name: id,
  baseUrl: `https://${id}.test/v1`,
  secret: `${id}-key`,
  headers: {},
  ...overrides,
});

/** Provider resources for tests: the given records (the built-in ones always resolve too). */
export const providerResources = (...records: Provider[]) => ({
  get: async (id: string) => findBuiltInProvider(id) ?? records.find((record) => record.id === id),
});

/** Makes every provider record call `adapter`, until `restoreAdapter`. */
export const useAdapter = (adapter: LlmAdapter) => adapters.set('openai-compatible', adapter);
export const restoreAdapter = () => adapters.set('openai-compatible', openaiCompatible);
