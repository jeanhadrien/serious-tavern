import type { PromptMessage, Provider, ReasoningEffort } from '@st/shared';

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
export type ChatResponse = {
  text: string;
  // The reasoning trace, read from the record's `reasoningFields`; absent when the model returned none.
  reasoning?: string;
  raw: unknown;
  usage?: unknown;
};
export type ChatOptions = {
  // The resolved provider record the call is made against.
  provider: Provider;
  // The record's secret, when it names one.
  apiKey?: string;
  signal: AbortSignal;
};
export type StreamOptions = ChatOptions & {
  onToken(textDelta: string): void;
  onReasoning(reasoningDelta: string): void;
};
/** Speaks one wire protocol (a provider record's `kind`); the record says which backend to call and how. */
export type LlmAdapter = {
  chat(request: ChatRequest, options: ChatOptions): Promise<ChatResponse>;
  // Optional. Callers fall back to `chat` when an adapter has no streaming support.
  stream?(request: ChatRequest, options: StreamOptions): Promise<ChatResponse>;
};
export const adapters = new Map<Provider['kind'], LlmAdapter>();
export function registerAdapter(kind: Provider['kind'], adapter: LlmAdapter) {
  adapters.set(kind, adapter);
}
