import { adapters, openrouter, type LlmAdapter } from '@st/engine';

/** Makes every provider record call `adapter` instead of the network, until `restoreAdapter`. */
export const useAdapter = (adapter: LlmAdapter) => adapters.set('openai-compatible', adapter);
export const restoreAdapter = () => adapters.set('openai-compatible', openrouter);
