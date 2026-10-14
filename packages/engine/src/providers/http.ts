import type { Provider } from '@st/shared';
import { parseResponseText, withoutSecret } from './wire-log.js';

/**
 * Wraps a caller's abort signal with an inactivity deadline. Call `touch` whenever
 * data arrives to push the deadline back, and `dispose` once the request is done.
 */
export function withIdleTimeout(signal: AbortSignal, ms: number, provider: string) {
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

/**
 * Turns a non-ok response into an error naming the provider (`<name> <status>: <message>`), plus the parsed
 * body for the wire log. Upstream text can echo the key back, and error messages end up in logs and toasts.
 */
export async function failedResponse(provider: Provider, response: Response, apiKey: string | undefined) {
  const text = await response.text();
  const parsed = parseResponseText(text);
  const error = (parsed as { error?: { message?: string } | string } | undefined)?.error;
  const message = typeof error === 'string' ? error : (error?.message ?? text);
  return {
    parsed,
    error: new Error(withoutSecret(`${provider.name} ${response.status}: ${message.slice(0, 500)}`, apiKey)),
  };
}
