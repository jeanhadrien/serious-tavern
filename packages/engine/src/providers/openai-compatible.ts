import { registerAdapter, type LlmAdapter } from './index.js';
import { resolveWireSettings } from './wire-settings.js';
import { withIdleTimeout } from './http.js';
import { listOpenAiModels } from './openai-models.js';
import { postCompletion, reasoningText } from './openai-request.js';
import { readStream } from './openai-stream.js';
import { assistantMessage, mergeFields, replayFieldsOf, toolCallsOf } from './assistant-message.js';
import { parseResponseText } from './wire-log.js';

// A stream is only considered stalled after this long without any bytes (keep-alive comments count).
const streamIdleTimeoutMs = 120_000;
// Without streaming there is no activity to observe, so this bounds the whole request.
const requestTimeoutMs = 600_000;

type CompletionChoice = {
  message?: { content?: unknown; tool_calls?: unknown } & Record<string, unknown>;
  finish_reason?: string | null;
};

/**
 * The adapter for `openai-compatible` provider records (OpenRouter, OpenAI, DeepSeek, Ollama, ...).
 * Everything backend-specific comes from the record: URL, auth, headers, the message-name field,
 * where reasoning is read from, which message fields are replayed, and raw `extraBody` fields;
 * overrides adjust these per model.
 */
export const openaiCompatible: LlmAdapter = {
  async chat(request, options) {
    const { provider } = options;
    const wire = resolveWireSettings(provider, request.model);
    const deadline = withIdleTimeout(options.signal, requestTimeoutMs, provider.name);
    try {
      const { response, record } = await postCompletion(request, false, { ...options, wire, signal: deadline.signal });
      const text = await response.text();
      const raw = parseResponseText(text);
      record({ status: response.status, response: raw });
      if (typeof raw === 'string') throw new Error(`${provider.name} returned a response that is not JSON`);
      const choice = (raw as { choices?: CompletionChoice[] }).choices?.[0];
      const message = choice?.message;
      const toolCalls = toolCallsOf(message?.tool_calls, provider.name);
      // A reply that only calls tools has `content: null`.
      const content = message?.content ?? (toolCalls.length ? '' : undefined);
      if (typeof content !== 'string') throw new Error(`${provider.name} returned no assistant text`);
      const reasoning = reasoningText(message, wire.reasoningFields);
      const providerData: Record<string, unknown> = {};
      mergeFields(providerData, replayFieldsOf(message, wire.replayFields));
      return {
        text: content,
        ...(reasoning ? { reasoning } : {}),
        message: assistantMessage({
          content,
          toolCalls,
          reasoning,
          providerData,
          provider,
          model: request.model,
          nodeId: options.nodeId,
        }),
        ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
        raw,
        usage: (raw as { usage?: unknown }).usage,
      };
    } finally {
      deadline.dispose();
    }
  },
  listModels: listOpenAiModels,
  async stream(request, { onToken, onReasoning, ...options }) {
    const deadline = withIdleTimeout(options.signal, streamIdleTimeoutMs, options.provider.name);
    try {
      const wire = resolveWireSettings(options.provider, request.model);
      return await readStream(request, { ...options, wire }, deadline, onToken, onReasoning);
    } finally {
      deadline.dispose();
    }
  },
};
registerAdapter('openai-compatible', openaiCompatible);
