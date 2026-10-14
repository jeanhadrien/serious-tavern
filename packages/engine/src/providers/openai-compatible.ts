import { registerAdapter, type ChatOptions, type ChatRequest, type ChatResponse, type LlmAdapter } from './index.js';
import { resolveWireSettings, type WireSettings } from './wire-settings.js';
import { failedResponse, withIdleTimeout } from './http.js';
import { listOpenAiModels } from './openai-models.js';
import { parseResponseText, streamFolder, wireRecorder, withoutSecret } from './wire-log.js';

// A stream is only considered stalled after this long without any bytes (keep-alive comments count).
const streamIdleTimeoutMs = 120_000;
// Without streaming there is no activity to observe, so this bounds the whole request.
const requestTimeoutMs = 600_000;

// A call against one record, with the wire settings for the request's model already resolved.
type Call = ChatOptions & { wire: WireSettings };

function requestBody(request: ChatRequest, stream: boolean, { messageName, extraBody }: WireSettings) {
  return {
    model: request.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
      // An empty name still counts as set.
      ...(messageName === null || message.name === undefined ? {} : { [messageName]: message.name }),
    })),
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    ...(stream ? { stream: true } : {}),
    ...(request.topP === undefined ? {} : { top_p: request.topP }),
    ...(request.frequencyPenalty === undefined ? {} : { frequency_penalty: request.frequencyPenalty }),
    ...(request.presencePenalty === undefined ? {} : { presence_penalty: request.presencePenalty }),
    ...(request.stop === undefined ? {} : { stop: request.stop }),
    ...reasoningParams(request),
    // Last, so the record can override or add any field.
    ...extraBody,
  };
}

/** The first configured reasoning field holding non-empty text, in a stream delta or a response message. */
function reasoningText(source: Record<string, unknown> | undefined, fields: string[]) {
  for (const field of fields) {
    const value = source?.[field];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/** Builds OpenRouter's unified `reasoning` object; nothing is sent when no option is set. */
function reasoningParams(request: ChatRequest) {
  const reasoning = {
    // 'off' sends nothing, leaving the model's own default reasoning behaviour in place.
    ...(request.reasoningEffort && request.reasoningEffort !== 'off' ? { effort: request.reasoningEffort } : {}),
    ...(request.reasoningMaxTokens === undefined ? {} : { max_tokens: request.reasoningMaxTokens }),
    ...(request.reasoningExclude ? { exclude: true } : {}),
  };
  return Object.keys(reasoning).length ? { reasoning } : {};
}

/**
 * Sends the request and reports it to `onWire` before it leaves. Returns the ok response together with
 * the recorder, so callers report the response once they have read it; an error response is reported here.
 */
async function postCompletion(request: ChatRequest, stream: boolean, { provider, apiKey, signal, wire, onWire }: Call) {
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers = {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    'Content-Type': 'application/json',
    ...wire.headers,
  };
  const body = requestBody(request, stream, wire);
  const record = wireRecorder(onWire, apiKey, { url, headers, body });
  record();
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!response.ok) {
    const { parsed, error } = await failedResponse(provider, response, apiKey);
    record({ status: response.status, response: parsed });
    throw error;
  }
  return { response, record };
}

// Yields the payload of each `data:` line. Comment lines (`: ...`) and other fields are ignored.
async function* serverSentData(body: ReadableStream<Uint8Array>, onChunk: () => void): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      onChunk();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
      if (done) break;
    }
    if (buffer.startsWith('data:')) yield buffer.slice(5).trim();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

type StreamChunk = {
  id?: string;
  model?: string;
  choices?: { delta?: { content?: string | null } & Record<string, unknown>; finish_reason?: string | null }[];
  usage?: unknown;
  error?: { message?: string };
};

type Deadline = ReturnType<typeof withIdleTimeout>;

async function readStream(
  request: ChatRequest,
  call: Call,
  deadline: Deadline,
  onToken: (textDelta: string) => void,
  onReasoning: (reasoningDelta: string) => void,
): Promise<ChatResponse> {
  const { provider, wire, apiKey } = call;
  const { response, record } = await postCompletion(request, true, { ...call, signal: deadline.signal });
  if (!response.body) throw new Error(`${provider.name} returned no stream`);
  const wireLog = streamFolder();
  let id: string | undefined;
  let model: string | undefined;
  let finishReason: string | null | undefined;
  let usage: unknown;
  let text = '';
  let reasoning = '';
  let sawChoice = false;
  try {
    for await (const data of serverSentData(response.body, deadline.touch)) {
      if (data === '[DONE]') break;
      const chunk = JSON.parse(data) as StreamChunk;
      wireLog.add(chunk);
      if (chunk.error)
        throw new Error(
          withoutSecret(`${provider.name} stream error: ${chunk.error.message ?? 'unknown error'}`, apiKey),
        );
      id ??= chunk.id;
      model ??= chunk.model;
      usage ??= chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      sawChoice = true;
      finishReason = choice.finish_reason ?? finishReason;
      const content = choice.delta?.content;
      if (typeof content === 'string' && content) {
        text += content;
        onToken(content);
      }
      const reasoningDelta = reasoningText(choice.delta, wire.reasoningFields);
      if (reasoningDelta) {
        reasoning += reasoningDelta;
        onReasoning(reasoningDelta);
      }
    }
  } finally {
    // Also after a mid-stream error, so the log shows what had arrived.
    record({ status: response.status, response: wireLog.folded });
  }
  if (!sawChoice) throw new Error(`${provider.name} returned no assistant text`);
  // Mirrors the non-streaming response shape, so the node's `raw` output stays comparable.
  // Reasoning is reported under `reasoning`, whichever wire field it came from.
  const raw = {
    id,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text, ...(reasoning ? { reasoning } : {}) },
        finish_reason: finishReason ?? null,
      },
    ],
    usage,
  };
  return { text, ...(reasoning ? { reasoning } : {}), raw, usage };
}

type CompletionMessage = { content?: unknown } & Record<string, unknown>;

/**
 * The adapter for `openai-compatible` provider records (OpenRouter, OpenAI, DeepSeek, Ollama, ...).
 * Everything backend-specific comes from the record: URL, auth, headers, the message-name field,
 * where reasoning is read from, and raw `extraBody` fields; overrides adjust these per model.
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
      const message = (raw as { choices?: { message?: CompletionMessage }[] }).choices?.[0]?.message;
      const content = message?.content;
      if (typeof content !== 'string') throw new Error(`${provider.name} returned no assistant text`);
      const reasoning = reasoningText(message, wire.reasoningFields);
      return { text: content, ...(reasoning ? { reasoning } : {}), raw, usage: (raw as { usage?: unknown }).usage };
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
