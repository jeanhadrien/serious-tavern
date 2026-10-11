import type { PromptMessage, ReasoningEffort } from '@st/shared';

export type ChatRequest = {
  messages: PromptMessage[];
  model: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  reasoningEffort?: ReasoningEffort;
  // Explicit reasoning budget in tokens; independent of `reasoningEffort`.
  reasoningMaxTokens?: number;
  // Keep reasoning internal: the model still thinks (and bills for it) but returns no trace.
  reasoningExclude?: boolean;
};
export type ChatResponse = { text: string; raw: unknown; usage?: unknown };
export type ChatOptions = { apiKey: string; signal: AbortSignal };
export type StreamOptions = ChatOptions & {
  onToken(textDelta: string): void;
  onReasoning(reasoningDelta: string): void;
};
export type LlmProvider = {
  id: string;
  label: string;
  secretName: string;
  chat(request: ChatRequest, options: ChatOptions): Promise<ChatResponse>;
  // Optional. Callers fall back to `chat` when a provider has no streaming support.
  stream?(request: ChatRequest, options: StreamOptions): Promise<ChatResponse>;
};
export const providers = new Map<string, LlmProvider>();
export function registerProvider(provider: LlmProvider) {
  providers.set(provider.id, provider);
}
