import type { ReplyEntry } from '@st/shared';

/**
 * The save queue behind the "On reply" list, without React. A change is a whole list (the PATCH replaces the list), so
 * one request is in flight at a time and the changes made meanwhile collapse into the newest list, which is sent next:
 * answers therefore arrive in order, and each one holds every earlier change. `setPending` shows the newest list before
 * the server confirms it and is cleared once the queue is idle. A failed save (already reported by `save`, which
 * resolves false) drops what was waiting and clears the shown list, so the panel falls back to what the server holds.
 */
export function createReplySaver(
  save: (list: ReplyEntry[]) => Promise<boolean>,
  setPending: (list: ReplyEntry[] | undefined) => void,
) {
  let inFlight = false;
  let queued: ReplyEntry[] | undefined;
  const send = (list: ReplyEntry[]) => {
    inFlight = true;
    void save(list)
      .catch(() => false)
      .then((saved) => {
        inFlight = false;
        const next = queued;
        queued = undefined;
        if (saved && next) return send(next);
        setPending(undefined);
      });
  };
  return {
    change(list: ReplyEntry[]) {
      setPending(list);
      if (inFlight) queued = list;
      else send(list);
    },
  };
}
