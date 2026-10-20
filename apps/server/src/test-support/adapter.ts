import { adapters, openaiCompatible, type ChatResponse, type LlmAdapter } from '@st/engine';

/** Makes every provider record call `adapter` instead of the network, until `restoreAdapter`. */
export const useAdapter = (adapter: LlmAdapter) => adapters.set('openai-compatible', adapter);
export const restoreAdapter = () => adapters.set('openai-compatible', openaiCompatible);

/** A canned adapter reply: the text and its canonical assistant message; `extra` overrides any field. */
export const chatResponse = (text: string, extra: Partial<ChatResponse> = {}): ChatResponse => ({
  text,
  message: { role: 'assistant', content: text },
  raw: {},
  ...extra,
});
