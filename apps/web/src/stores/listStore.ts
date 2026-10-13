import type { ChangeEvent } from '@st/shared';
import { subscribeToChanges } from '../api/events.js';

export interface ListStoreOptions<T> {
  /** The change event that makes the list stale. */
  event: ChangeEvent['type'];
  /** Fetches the whole list. */
  load(): Promise<T[]>;
  /** Total order of the list; the fetched array is sorted with it. */
  compare(a: T, b: T): number;
}

export interface ListStore<T> {
  getSnapshot(): T[];
  /** useSyncExternalStore-compatible. The store follows server change events while it has subscribers. */
  subscribe(listener: () => void): () => void;
  /**
   * Fetches the list and resolves with it. Calls made in the same tick, or while a fetch is running, share one
   * fetch that starts after the call, so the result reflects every write made before it. Rejects if the fetch fails.
   */
  refresh(): Promise<T[]>;
}

const sameItems = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A client-side copy of one server list, shared by every component that reads it. It loads when the first
 * subscriber appears and re-fetches on its change event (the server also sends every event on connect, so a
 * reconnecting client resyncs). An unchanged result keeps the array identity, so readers do not re-render.
 */
export function createListStore<T>({ event, load, compare }: ListStoreOptions<T>): ListStore<T> {
  let items: T[] = [];
  const listeners = new Set<() => void>();
  let stopListening: (() => void) | undefined;
  let running: Promise<unknown> | undefined;
  let queued: Promise<T[]> | undefined;

  const fetchList = async () => {
    const fresh = (await load()).sort(compare);
    if (sameItems(items, fresh)) return items;
    items = fresh;
    for (const listener of [...listeners]) listener();
    return items;
  };
  const run = () => {
    queued = undefined;
    const current = fetchList();
    const done = current.then(
      () => undefined,
      () => undefined,
    );
    running = done;
    void done.then(() => {
      if (running === done) running = undefined;
    });
    return current;
  };
  const refresh = () => {
    queued ??= (running ?? Promise.resolve()).then(run);
    return queued;
  };
  const refreshQuietly = () => void refresh().catch(() => {});

  return {
    getSnapshot: () => items,
    refresh,
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        stopListening = subscribeToChanges((change) => {
          if (change.type === event) refreshQuietly();
        });
        refreshQuietly();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopListening?.();
          stopListening = undefined;
        }
      };
    },
  };
}
