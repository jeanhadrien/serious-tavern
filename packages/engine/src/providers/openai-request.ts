import type { ChatOptions, ChatRequest } from './index.js';
import { failedResponse } from './http.js';
import { mergeAssistantMessages, toolParams, wireMessage } from './wire-messages.js';
import type { WireSettings } from './wire-settings.js';
import { wireRecorder } from './wire-log.js';

// A call against one record, with the wire settings for the request's model already resolved.
export type Call = ChatOptions & { wire: WireSettings };

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

function requestBody(request: ChatRequest, stream: boolean, wire: WireSettings) {
  return {
    model: request.model,
    messages: (wire.mergeAssistantMessages ? mergeAssistantMessages(request.messages) : request.messages).map(
      (message) => wireMessage(message, wire),
    ),
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    ...(stream ? { stream: true } : {}),
    ...(request.topP === undefined ? {} : { top_p: request.topP }),
    ...(request.frequencyPenalty === undefined ? {} : { frequency_penalty: request.frequencyPenalty }),
    ...(request.presencePenalty === undefined ? {} : { presence_penalty: request.presencePenalty }),
    ...(request.stop === undefined ? {} : { stop: request.stop }),
    ...reasoningParams(request),
    ...toolParams(request),
    // Last, so the record can override or add any field.
    ...wire.extraBody,
  };
}

/** The first configured reasoning field holding non-empty text, in a stream delta or a response message. */
export function reasoningText(source: Record<string, unknown> | undefined, fields: string[]) {
  for (const field of fields) {
    const value = source?.[field];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/**
 * Sends the request and reports it to `onWire` before it leaves. Returns the ok response together with
 * the recorder, so callers report the response once they have read it; an error response is reported here.
 */
export async function postCompletion(
  request: ChatRequest,
  stream: boolean,
  { provider, apiKey, signal, wire, onWire }: Call,
) {
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
