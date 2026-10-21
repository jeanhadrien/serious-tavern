import type {
  ConversationMessage,
  PromptMessage,
  Provider,
  ProviderModel,
  ReasoningEffort,
  ToolDefinition,
  WireExchange,
} from '@st/shared';

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
  // Function tools the model may call, sent as `tools`; none are sent when the list is empty.
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  parallelToolCalls?: boolean;
};
export type ChatResponse = {
  text: string;
  // The reasoning trace, read from the record's `reasoningFields`; absent when the model returned none.
  reasoning?: string;
  // The assistant message in canonical form: content, tool calls, reasoning, the record's replay fields in
  // `provider_data`, and provenance (this record, the request's model, `ChatOptions.nodeId`).
  message: ConversationMessage;
  // Why the model stopped (`stop`, `tool_calls`, `length`, ...), as the backend reported it.
  finishReason?: string;
  raw: unknown;
  usage?: unknown;
};
export type ChatOptions = {
  // The resolved provider record the call is made against.
  provider: Provider;
  // The LLM node making the call; the adapter stamps it into the reply's provenance.
  nodeId: string;
  // The record's secret, when it names one.
  apiKey?: string;
  signal: AbortSignal;
  // Receives what actually goes over the wire for this one call, credentials redacted: first the request, then
  // again with the response, each report replacing the last. A caller making several calls starts a new log entry
  // between them (`ctx.beginWire`).
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
