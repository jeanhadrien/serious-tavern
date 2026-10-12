import { changeEventSchema, changeEventTypes, type ChangeEvent } from '@st/shared';

type Listener = (event: ChangeEvent) => void;

// A source the browser gave up on (refused or proxied error response) is reopened after this delay.
const REOPEN_MS = 3000;

// One connection serves every subscriber; it is opened by the first and closed with the last.
const listeners = new Set<Listener>();
let source: EventSource | undefined;
let reopenTimer: ReturnType<typeof setTimeout> | undefined;

function dispatch(message: MessageEvent) {
  let data: unknown;
  try {
    data = JSON.parse(String(message.data));
  } catch {
    return;
  }
  const parsed = changeEventSchema.safeParse(data);
  if (!parsed.success) return;
  for (const listener of [...listeners]) {
    try {
      listener(parsed.data);
    } catch (error) {
      console.error('Change event listener failed', error);
    }
  }
}

function connect() {
  if (source || listeners.size === 0) return;
  const next = new EventSource('/api/events');
  source = next;
  for (const type of changeEventTypes) next.addEventListener(type, dispatch);
  next.onerror = () => {
    // While the browser is reconnecting by itself there is nothing to do. The server resends the
    // current state on every connect, so changes missed in between are picked up.
    if (next.readyState !== EventSource.CLOSED) return;
    next.close();
    source = undefined;
    reopenTimer = setTimeout(connect, REOPEN_MS);
  };
}

function disconnect() {
  clearTimeout(reopenTimer);
  reopenTimer = undefined;
  source?.close();
  source = undefined;
}

/**
 * Subscribes to server-side change events (resources edited on disk). Returns the unsubscribe function.
 * The server sends the current state when a connection opens, so listeners should treat every event as
 * "re-fetch if you care", never as a delta.
 */
export function subscribeToChanges(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) disconnect();
  };
}
