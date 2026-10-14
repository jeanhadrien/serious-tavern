import { normalizeModels, type ProviderModel } from '@st/shared';
import type { ListModelsOptions } from './index.js';
import { failedResponse, withIdleTimeout } from './http.js';
import { parseResponseText, withoutSecret } from './wire-log.js';

// A model list is a small request; a backend that takes longer than this is treated as unreachable.
const listTimeoutMs = 30_000;

/** The error text for a fetch that never got a response, with the low-level cause (`connect ECONNREFUSED ...`). */
function unreachable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
  return cause ? `${message} (${cause})` : message;
}

/**
 * `GET <baseUrl>/models`, the de facto way an OpenAI-compatible backend lists what it serves. Auth follows
 * the chat rule (Bearer only when the record names a secret) and only the record's top-level `headers` are
 * sent, since overrides are per model. Errors name the provider and never contain the key.
 */
export async function listOpenAiModels({ provider, apiKey, signal }: ListModelsOptions): Promise<ProviderModel[]> {
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/models`;
  const headers = { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...provider.headers };
  const deadline = withIdleTimeout(signal, listTimeoutMs, provider.name);
  try {
    const response = await fetch(url, { method: 'GET', headers, signal: deadline.signal }).catch((error: unknown) => {
      // A timeout or abort already carries its own message.
      if (deadline.signal.aborted) throw deadline.signal.reason;
      throw new Error(withoutSecret(`${provider.name} could not be reached: ${unreachable(error)}`, apiKey));
    });
    if (!response.ok) throw (await failedResponse(provider, response, apiKey)).error;
    const payload = parseResponseText(await response.text());
    if (typeof payload === 'string') throw new Error(`${provider.name} returned a response that is not JSON`);
    const models = normalizeModels(payload);
    if (!models) throw new Error(`${provider.name} returned no model list (expected { "data": [...] })`);
    return models;
  } finally {
    deadline.dispose();
  }
}
