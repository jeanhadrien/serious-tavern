import { useEffect, useRef, useState } from 'react';

const debounceMs = 500;
type Pending = Record<string, unknown>;
type SaveOne = (patch: Record<string, unknown>) => Promise<void>;

/**
 * The save queue behind the chat panel, without React: toggles and selects save at once, typed values
 * after `delay` (or on `flush`). `pending` holds values shown before the server confirms them (`null`:
 * reset to the default); entries are dropped once every save in flight has answered, because an earlier
 * answer may be outdated by a later one.
 */
export function createSettingSaver(
  save: SaveOne,
  setPending: (update: (current: Pending) => Pending) => void,
  delay = debounceMs,
) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const unsent = new Map<string, unknown>();
  const sent = new Map<string, unknown>();
  let inFlight = 0;
  const stopTimer = (key: string) => {
    clearTimeout(timers.get(key));
    timers.delete(key);
  };
  const send = (key: string, value: unknown) => {
    stopTimer(key);
    unsent.delete(key);
    inFlight++;
    sent.set(key, value);
    // A failed save is the caller's to report; the panel then shows what the server holds.
    void save({ [key]: value })
      .catch(() => {})
      .then(() => {
        if (--inFlight > 0) return;
        const done = new Map(sent);
        sent.clear();
        setPending((current) => {
          const next = { ...current };
          for (const [field, value] of done) if (Object.is(next[field], value)) delete next[field];
          return next;
        });
      });
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
    /** Sends every value still waiting for its pause, e.g. when the panel closes. */
    flushAll() {
      for (const [key, value] of [...unsent]) send(key, value);
    },
  };
}

/**
 * `createSettingSaver` for one chat. Unsent values are saved when the panel closes or the chat changes
 * (the component is keyed by session), so an edit is never lost.
 */
export function useSettingSaver(sessionId: string, onSave: (sessionId: string, patch: Pending) => Promise<void>) {
  const [pending, setPending] = useState<Pending>({});
  const target = useRef({ sessionId, onSave });
  target.current = { sessionId, onSave };
  const saver = useRef<ReturnType<typeof createSettingSaver>>(undefined);
  saver.current ??= createSettingSaver((patch) => target.current.onSave(target.current.sessionId, patch), setPending);
  useEffect(() => () => saver.current?.flushAll(), []);
  return { pending, ...saver.current };
}
