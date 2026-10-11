import { registerProvider, type ChatRequest, type LlmProvider } from './index.js';

const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

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
    // 'off' sends nothing, leaving the model's own default reasoning behaviour in place.
    ...(request.reasoningEffort === undefined || request.reasoningEffort === 'off'
      ? {}
      : { reasoning: { effort: request.reasoningEffort } }),
  };
}

async function postCompletion(request: ChatRequest, stream: boolean, options: { apiKey: string; signal: AbortSignal }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/serious-tavern',
      'X-Title': 'Serious Tavern',
    },
    body: JSON.stringify(requestBody(request, stream)),
    signal: options.signal,
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
    throw new Error(`OpenRouter ${response.status}: ${message.slice(0, 500)}`);
  }
  return response;
}

// Yields the payload of each `data:` line. Comment lines (`: ...`) and other fields are ignored.
async function* serverSentData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
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

export const openrouter: LlmProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  secretName: 'openrouter',
  async chat(request, { apiKey, signal }) {
    const response = await postCompletion(request, false, { apiKey, signal });
    const raw: unknown = await response.json();
    const text = (raw as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('OpenRouter returned no assistant text');
    return { text, raw, usage: (raw as { usage?: unknown }).usage };
  },
  async stream(request, { apiKey, signal, onToken, onReasoning }) {
    const response = await postCompletion(request, true, { apiKey, signal });
    if (!response.body) throw new Error('OpenRouter returned no stream');
    let id: string | undefined;
    let model: string | undefined;
    let finishReason: string | null | undefined;
    let usage: unknown;
    let text = '';
    let reasoning = '';
    let sawChoice = false;
    for await (const data of serverSentData(response.body)) {
      if (data === '[DONE]') break;
      const chunk = JSON.parse(data) as StreamChunk;
      if (chunk.error) throw new Error(`OpenRouter stream error: ${chunk.error.message ?? 'unknown error'}`);
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
    if (!sawChoice) throw new Error('OpenRouter returned no assistant text');
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
  },
};
registerProvider(openrouter);
