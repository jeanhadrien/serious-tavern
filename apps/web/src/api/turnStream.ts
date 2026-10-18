import { turnEventSchema, type ApiResponse } from '@st/shared';
import { ApiError, apiErrorFrom, networkError } from './transport.js';

export type TurnResult = ApiResponse<'sendMessage'>;

export type TurnHandlers = {
  /** The turn began on the server. Until then the message may be waiting in its queue and can still be cancelled. */
  onStart?: () => void;
  onDelta?: (nodeId: string, textDelta?: string, reasoningDelta?: string) => void;
  onComplete?: (result: TurnResult) => void;
};

/**
 * Sends a message and reads the turn's server-sent events until it settles.
 * Resolves after `turn.complete`; throws an ApiError for `turn.error` (the code and details are the
 * server's), a failed request, or a connection that ended early. Aborting the signal rejects with
 * an AbortError. Nothing is toasted here: the caller decides what to show.
 */
export async function streamMessage(
  id: string,
  content: string,
  handlers: TurnHandlers,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/sessions/${id}/messages/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: options.signal,
    });
  } catch (cause) {
    throw isAbort(cause) ? cause : networkError(cause);
  }
  if (!response.ok) {
    throw apiErrorFrom(response.status, response.statusText, await response.json().catch(() => undefined));
  }
  if (!response.body) throw networkError('The response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (handleFrame(frame, handlers)) return;
      }
      if (done) throw networkError('The connection closed before the turn finished');
    }
  } catch (cause) {
    throw cause instanceof ApiError || isAbort(cause) ? cause : networkError(cause);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Dispatches one SSE frame. Returns true when it was the turn's `turn.complete`; throws on `turn.error`. */
function handleFrame(frame: string, handlers: TurnHandlers): boolean {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return false;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return false;
  }
  const parsed = turnEventSchema.safeParse(json);
  if (!parsed.success) return false;
  const event = parsed.data;
  switch (event.type) {
    case 'turn.start':
      handlers.onStart?.();
      return false;
    case 'node.delta':
      handlers.onDelta?.(event.nodeId, event.textDelta, event.reasoningDelta);
      return false;
    case 'turn.complete':
      handlers.onComplete?.(event);
      return true;
    case 'turn.error':
      throw new ApiError(0, event.error.code, event.error.message, event.error.details);
    default:
      return false;
  }
}
