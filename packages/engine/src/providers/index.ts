import type { PromptMessage, Provider, ProviderModel, ReasoningEffort, WireExchange } from '@st/shared';

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
  // Receives what actually goes over the wire, credentials redacted: first the request, then again with the response.
  onWire?(exchange: WireExchange): void;
};
export type StreamOptions = ChatOptions & {
  onToken(textDelta: string): void;
  onReasoning(reasoningDelta: string): void;
};
export type ListModelsOptions = {
  provider: Provider;
  // The record's secret, when it names one.
  apiKey?: string;
  signal: AbortSignal;
};
/** Speaks one wire protocol (a provider record's `kind`); the record says which backend to call and how. */
export type LlmAdapter = {
  chat(request: ChatRequest, options: ChatOptions): Promise<ChatResponse>;
  // Optional. Callers fall back to `chat` when an adapter has no streaming support.
  stream?(request: ChatRequest, options: StreamOptions): Promise<ChatResponse>;
  // Optional. The models the backend serves, normalized; throws an error naming the provider on failure.
  listModels?(options: ListModelsOptions): Promise<ProviderModel[]>;
};
export const adapters = new Map<Provider['kind'], LlmAdapter>();
export function registerAdapter(kind: Provider['kind'], adapter: LlmAdapter) {
  adapters.set(kind, adapter);
}

/** The error text for a record whose `secret` names a secret that is not stored. */
export const missingSecretMessage = (secret: string) => `Missing ${secret} secret. Add it in Settings.`;
