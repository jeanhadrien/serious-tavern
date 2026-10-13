import { registerAdapter, type ChatOptions, type ChatRequest, type ChatResponse, type LlmAdapter } from './index.js';

// A stream is only considered stalled after this long without any bytes (keep-alive comments count).
const streamIdleTimeoutMs = 120_000;
// Without streaming there is no activity to observe, so this bounds the whole request.
const requestTimeoutMs = 600_000;

/**
 * Wraps a caller's abort signal with an inactivity deadline. Call `touch` whenever
 * data arrives to push the deadline back, and `dispose` once the request is done.
 */
function withIdleTimeout(signal: AbortSignal, ms: number, provider: string) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error(`${provider} timed out after ${ms / 1000}s without a response`)),
      ms,
    );
  };
  touch();
  return {
    signal: AbortSignal.any([signal, controller.signal]),
    touch,
    dispose: () => clearTimeout(timer),
  };
}

function requestBody(request: ChatRequest, stream: boolean) {
  return {
    model: request.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.name === undefined ? {} : { name: message.name }),
    })),
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    ...(stream ? { stream: true } : {}),
    ...(request.topP === undefined ? {} : { top_p: request.topP }),
    ...(request.frequencyPenalty === undefined ? {} : { frequency_penalty: request.frequencyPenalty }),
    ...(request.presencePenalty === undefined ? {} : { presence_penalty: request.presencePenalty }),
    ...(request.stop === undefined ? {} : { stop: request.stop }),
    ...reasoningParams(request),
  };
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

async function postCompletion(request: ChatRequest, stream: boolean, { provider, apiKey, signal }: ChatOptions) {
  const response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': 'application/json',
      ...provider.headers,
    },
    body: JSON.stringify(requestBody(request, stream)),
    signal,
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string };
      message = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? body);
    } catch {
      message = body;
    }
    throw new Error(`${provider.name} ${response.status}: ${message.slice(0, 500)}`);
  }
  return response;
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
  choices?: { delta?: { content?: string | null; reasoning?: string | null }; finish_reason?: string | null }[];
  usage?: unknown;
  error?: { message?: string };
};

type Deadline = ReturnType<typeof withIdleTimeout>;

async function readStream(
  request: ChatRequest,
  { provider, apiKey }: ChatOptions,
  deadline: Deadline,
  onToken: (textDelta: string) => void,
  onReasoning: (reasoningDelta: string) => void,
): Promise<ChatResponse> {
  const response = await postCompletion(request, true, { provider, apiKey, signal: deadline.signal });
  if (!response.body) throw new Error(`${provider.name} returned no stream`);
  let id: string | undefined;
  let model: string | undefined;
  let finishReason: string | null | undefined;
  let usage: unknown;
  let text = '';
  let reasoning = '';
  let sawChoice = false;
  for await (const data of serverSentData(response.body, deadline.touch)) {
    if (data === '[DONE]') break;
    const chunk = JSON.parse(data) as StreamChunk;
    if (chunk.error) throw new Error(`${provider.name} stream error: ${chunk.error.message ?? 'unknown error'}`);
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
    const reasoningDelta = choice.delta?.reasoning;
    if (typeof reasoningDelta === 'string' && reasoningDelta) {
      reasoning += reasoningDelta;
      onReasoning(reasoningDelta);
    }
  }
  if (!sawChoice) throw new Error(`${provider.name} returned no assistant text`);
  // Mirrors the non-streaming response shape, so the node's `raw` output stays comparable.
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
  return { text, raw, usage };
}

export const openrouter: LlmAdapter = {
  async chat(request, { provider, apiKey, signal }) {
    const deadline = withIdleTimeout(signal, requestTimeoutMs, provider.name);
    try {
      const response = await postCompletion(request, false, { provider, apiKey, signal: deadline.signal });
      const raw: unknown = await response.json();
      const text = (raw as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error(`${provider.name} returned no assistant text`);
      return { text, raw, usage: (raw as { usage?: unknown }).usage };
    } finally {
      deadline.dispose();
    }
  },
  async stream(request, { onToken, onReasoning, ...options }) {
    const deadline = withIdleTimeout(options.signal, streamIdleTimeoutMs, options.provider.name);
    try {
      return await readStream(request, options, deadline, onToken, onReasoning);
    } finally {
      deadline.dispose();
    }
  },
};
registerAdapter('openai-compatible', openrouter);
