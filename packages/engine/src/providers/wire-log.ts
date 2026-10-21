import type { WireExchange } from '@st/shared';
import { mergeToolCalls } from './assistant-message.js';

const redacted = '[redacted]';
// Header names that may carry a credential, whether set by the adapter or typed into a record's `headers`.
const credentialHeader = /auth|key|token|secret|cookie|password/i;

/** Masks credential-looking header values, keeping an auth scheme (`Bearer [redacted]`) visible for debugging. */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      if (!credentialHeader.test(name)) return [name, value];
      const scheme = /^(Bearer|Basic|Token)\s/i.exec(value)?.[1];
      return [name, scheme ? `${scheme} ${redacted}` : redacted];
    }),
  );
}

/**
 * Replaces every occurrence of the secret anywhere in a JSON value (or string), as a last line of defence.
 * Also used on error messages built from upstream text, which may echo the key back.
 */
export function withoutSecret<T>(value: T, secret: string | undefined): T {
  if (!secret) return value;
  const json = JSON.stringify(value);
  // The secret as it appears inside a JSON string.
  const escaped = JSON.stringify(secret).slice(1, -1);
  return json.includes(escaped) ? (JSON.parse(json.split(escaped).join(redacted)) as T) : value;
}

type Sent = { url: string; headers: Record<string, string>; body: unknown };
type Received = { status: number; response?: unknown };

/**
 * Reports one request to `onWire` with credentials removed. Call the returned function with no
 * argument before sending, then again once the response (or part of a stream) is known; each report
 * replaces the previous one, so a failed call still leaves what was sent in the log.
 */
export function wireRecorder(
  onWire: ((exchange: WireExchange) => void) | undefined,
  secret: string | undefined,
  sent: Sent,
) {
  const request = { url: sent.url, method: 'POST', headers: redactHeaders(sent.headers), body: sent.body };
  return (received?: Received) => onWire?.(withoutSecret({ ...request, ...received }, secret));
}

/** Parses a response body as JSON, or keeps its (truncated) text when it is not JSON. */
export function parseResponseText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
}

type Fields = Record<string, unknown>;

// Later values replace earlier ones; nulls are ignored. Inside a delta, string fields are text pieces and are
// concatenated, except `role`, a label some backends repeat on every chunk; arrays (`reasoning_details`) are
// pieces too, and `tool_calls` is merged by index, the way the adapter reads it.
function mergeInto(target: Fields, source: Fields, isDelta = false) {
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    const previous = target[key];
    if (isDelta && key === 'tool_calls' && Array.isArray(value)) {
      const calls = Array.isArray(previous) ? (previous as Fields[]) : [];
      mergeToolCalls(calls, value);
      target[key] = calls;
    } else if (isDelta && Array.isArray(value) && Array.isArray(previous)) target[key] = [...previous, ...value];
    else if (isDelta && key !== 'role' && typeof value === 'string' && typeof previous === 'string')
      target[key] = previous + value;
    else target[key] = value;
  }
}

/**
 * Accumulates stream chunks into one object for the wire log. Unlike the node's `raw` output, which
 * mirrors a non-stream response, it keeps the backend's own field names (`reasoning_content`, ...),
 * so a mismatch with the record's mapping is visible.
 */
export function streamFolder() {
  const folded: Fields & { choices?: Fields[] } = {};
  return {
    folded,
    add(chunk: Fields) {
      const { choices, ...rest } = chunk;
      mergeInto(folded, rest);
      if (!Array.isArray(choices)) return;
      folded.choices ??= [];
      for (const choice of choices as Fields[]) {
        const { delta, ...choiceRest } = choice;
        const index = typeof choice.index === 'number' ? choice.index : 0;
        const target: Fields = folded.choices[index] ?? {};
        folded.choices[index] = target;
        mergeInto(target, choiceRest);
        if (delta && typeof delta === 'object') {
          const text: Fields = (target.delta as Fields | undefined) ?? {};
          target.delta = text;
          mergeInto(text, delta as Fields, true);
        }
      }
    },
  };
}
