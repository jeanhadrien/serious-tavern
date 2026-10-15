import { useEffect, useRef, useState } from 'react';

const debounceMs = 500;
type Pending = Record<string, unknown>;
export type SaveOptions = { keepalive?: boolean };
type SaveSome = (patch: Record<string, unknown>, options?: SaveOptions) => Promise<void>;

/**
 * The save queue behind the chat panel, without React: toggles and selects save at once, typed values
 * after `delay` (or on `flush`). One request is in flight at a time; values due meanwhile go out together in
 * the next one, so each answer already holds every earlier write and answers arrive in order. `pending` holds
 * values shown before the server confirms them (`null`: reset to the default); they are dropped once the
 * queue is idle.
 */
export function createSettingSaver(
  save: SaveSome,
  setPending: (update: (current: Pending) => Pending) => void,
  delay = debounceMs,
) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Waiting for their pause.
  const unsent = new Map<string, unknown>();
  // Due, waiting for the request in flight.
  const queued = new Map<string, unknown>();
  // Sent since the queue was last idle.
  const sent = new Map<string, unknown>();
  let inFlight = false;
  const stopTimer = (key: string) => {
    clearTimeout(timers.get(key));
    timers.delete(key);
  };
  const dropPending = (done: ReadonlyMap<string, unknown>) =>
    setPending((current) => {
      const next = { ...current };
      for (const [field, value] of done) if (Object.is(next[field], value)) delete next[field];
      return next;
    });
  const pump = () => {
    if (inFlight || !queued.size) return;
    const patch = Object.fromEntries(queued);
    queued.clear();
    for (const [key, value] of Object.entries(patch)) sent.set(key, value);
    inFlight = true;
    // A failed save is the caller's to report; the panel then shows what the server holds.
    void save(patch)
      .catch(() => {})
      .then(() => {
        inFlight = false;
        if (queued.size) return pump();
        const done = new Map(sent);
        sent.clear();
        dropPending(done);
      });
  };
  const send = (key: string, value: unknown) => {
    stopTimer(key);
    unsent.delete(key);
    queued.set(key, value);
    pump();
  };
  return {
    change(key: string, value: unknown, mode: 'now' | 'debounced') {
      setPending((current) => ({ ...current, [key]: value }));
      stopTimer(key);
      if (mode === 'now') return send(key, value);
      unsent.set(key, value);
      timers.set(
        key,
        setTimeout(() => send(key, value), delay),
      );
    },
    flush(key: string) {
      if (unsent.has(key)) send(key, unsent.get(key));
    },
    // `null` removes the stored value, so the declared default applies again.
    reset(key: string) {
      setPending((current) => ({ ...current, [key]: null }));
      send(key, null);
    },
    /**
     * Drops a value not sent yet (e.g. the field now holds text that isn't a valid value), so an earlier
     * partial input is never saved; the control shows the stored value again.
     */
    cancel(key: string) {
      stopTimer(key);
      unsent.delete(key);
      queued.delete(key);
      setPending((current) => {
        if (!Object.hasOwn(current, key)) return current;
        const { [key]: _dropped, ...rest } = current;
        return rest;
      });
    },
    /** Sends every value still waiting for its pause, e.g. when the panel closes. */
    flushAll() {
      for (const [key, value] of [...unsent]) send(key, value);
    },
    /**
     * The page is going away: sends everything not sent yet in one request that outlives the page
     * (`keepalive`), without waiting for the request in flight.
     */
    flushNow() {
      for (const key of [...timers.keys()]) stopTimer(key);
      // A value still waiting for its pause is newer than one queued for the same key.
      const patch = Object.fromEntries([...queued, ...unsent]);
      unsent.clear();
      queued.clear();
      if (Object.keys(patch).length) void save(patch, { keepalive: true }).catch(() => {});
    },
  };
}

/**
 * `createSettingSaver` for one chat. Unsent values are saved when the panel closes or the chat changes
 * (the component is keyed by session), and when the page is hidden for good (reload, tab close), so an edit
 * is never lost.
 */
export function useSettingSaver(
  sessionId: string,
  onSave: (sessionId: string, patch: Pending, options?: SaveOptions) => Promise<void>,
) {
  const [pending, setPending] = useState<Pending>({});
  const target = useRef({ sessionId, onSave });
  target.current = { sessionId, onSave };
  const saver = useRef<ReturnType<typeof createSettingSaver>>(undefined);
  saver.current ??= createSettingSaver(
    (patch, options) => target.current.onSave(target.current.sessionId, patch, options),
    setPending,
  );
  useEffect(() => {
    const leave = () => saver.current?.flushNow();
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      saver.current?.flushAll();
    };
  }, []);
  return { pending, ...saver.current };
}
