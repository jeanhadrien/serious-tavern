import { turnEventSchema, type ApiResponse } from '@st/shared';
import { ApiError, apiErrorFrom, networkError } from './transport.js';

export type TurnResult = ApiResponse<'sendMessage'>;

/** Streamed text of one Chat Output of one run. `runId` is absent in events of a server from before reply lists. */
type TurnDelta = { nodeId: string; runId?: string; textDelta?: string; reasoningDelta?: string };
/** A run of the reply list is starting: its node events follow, tagged with its `runId`. */
type RunStart = { runId: string; workflowId: string; workflowName: string };

export type TurnHandlers = {
  /** The turn began on the server. Until then the message may be waiting in its queue and can still be cancelled. */
  onStart?: () => void;
  /** One run per enabled workflow of the chat's reply list begins, one after another, before its node events. */
  onRun?: (run: RunStart) => void;
  onDelta?: (delta: TurnDelta) => void;
  onComplete?: (result: TurnResult) => void;
};

/**
 * Sends a message and reads the turn's server-sent events until it settles.
 * Resolves after `turn.complete`; throws an ApiError for `turn.error` (the code and details are the
 * server's), a failed request, or a connection that ended early. Aborting the signal rejects with
 * an AbortError. Nothing is toasted here: the caller decides what to show.
 */
export function streamMessage(
  id: string,
  content: string,
  handlers: TurnHandlers,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  return readTurn(
    `/api/sessions/${id}/messages/stream`,
    { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) },
    handlers,
    options,
  );
}

/** Runs the chat's last turn again (no body, no user message) and reads the same events as `streamMessage`. */
export function streamRegenerate(
  id: string,
  handlers: TurnHandlers,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  return readTurn(`/api/sessions/${id}/regenerate/stream`, {}, handlers, options);
}

async function readTurn(
  url: string,
  init: { headers?: Record<string, string>; body?: string },
  handlers: TurnHandlers,
  options: { signal?: AbortSignal },
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', ...init, signal: options.signal });
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
    case 'run.start':
      handlers.onRun?.({ runId: event.runId, workflowId: event.workflowId, workflowName: event.workflowName });
      return false;
    case 'node.delta':
      handlers.onDelta?.({
        nodeId: event.nodeId,
        ...(event.runId !== undefined && { runId: event.runId }),
        ...(event.textDelta !== undefined && { textDelta: event.textDelta }),
        ...(event.reasoningDelta !== undefined && { reasoningDelta: event.reasoningDelta }),
      });
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
