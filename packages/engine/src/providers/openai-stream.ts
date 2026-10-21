import type { ChatRequest, ChatResponse } from './index.js';
import type { withIdleTimeout } from './http.js';
import { assistantMessage, mergeFields, mergeToolCalls, replayFieldsOf, toolCallsOf } from './assistant-message.js';
import { postCompletion, reasoningText, type Call } from './openai-request.js';
import { streamFolder, withoutSecret } from './wire-log.js';

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
  choices?: {
    delta?: { content?: string | null; tool_calls?: unknown[] } & Record<string, unknown>;
    finish_reason?: string | null;
  }[];
  usage?: unknown;
  error?: { message?: string };
};

type Deadline = ReturnType<typeof withIdleTimeout>;

/** Reads a streamed completion, reporting text and reasoning as they arrive, and returns the folded response. */
export async function readStream(
  request: ChatRequest,
  call: Call,
  deadline: Deadline,
  onToken: (textDelta: string) => void,
  onReasoning: (reasoningDelta: string) => void,
): Promise<ChatResponse> {
  const { provider, wire, apiKey, nodeId } = call;
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
  const streamedCalls: Record<string, unknown>[] = [];
  const providerData: Record<string, unknown> = {};
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
      if (Array.isArray(choice.delta?.tool_calls)) mergeToolCalls(streamedCalls, choice.delta.tool_calls);
      mergeFields(providerData, replayFieldsOf(choice.delta, wire.replayFields));
    }
  } finally {
    // Also after a mid-stream error, so the log shows what had arrived.
    record({ status: response.status, response: wireLog.folded });
  }
  if (!sawChoice) throw new Error(`${provider.name} returned no assistant text`);
  const toolCalls = toolCallsOf(streamedCalls, provider.name);
  // Mirrors the non-streaming response shape, so the node's `raw` output stays comparable.
  // Reasoning is reported under `reasoning`, whichever wire field it came from.
  const raw = {
    id,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          ...(reasoning ? { reasoning } : {}),
          ...providerData,
        },
        finish_reason: finishReason ?? null,
      },
    ],
    usage,
  };
  const message = assistantMessage({
    content: text,
    toolCalls,
    reasoning,
    providerData,
    provider,
    model: request.model,
    nodeId,
  });
  return {
    text,
    ...(reasoning ? { reasoning } : {}),
    message,
    ...(finishReason ? { finishReason } : {}),
    raw,
    usage,
  };
}
