import type { PromptMessage } from '@st/shared';

export type ChatRequest = {
  messages: PromptMessage[];
  model: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
};
export type ChatResponse = { text: string; raw: unknown; usage?: unknown };
export type LlmProvider = {
  id: string;
  label: string;
  secretName: string;
  chat(request: ChatRequest, options: { apiKey: string; signal: AbortSignal }): Promise<ChatResponse>;
  // A future stream method can be added without changing chat callers.
};
export const providers = new Map<string, LlmProvider>();
export function registerProvider(provider: LlmProvider) {
  providers.set(provider.id, provider);
}
