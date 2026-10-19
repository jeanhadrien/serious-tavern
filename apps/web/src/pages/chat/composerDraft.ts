import { safeStorage } from '../../safeStorage.js';

// The text typed in a chat's composer, kept per chat in this browser (never on the server). All storage access is
// guarded: with blocked or full storage the draft is simply not remembered.

const PREFIX = 'st.composer.';
const SAVE_DELAY_MS = 300;

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem' | 'removeItem'>;

export function loadDraft(sessionId: string, storage: Reader | undefined = safeStorage()): string {
  try {
    return storage?.getItem(PREFIX + sessionId) ?? '';
  } catch {
    return '';
  }
}

/** Stores the draft; an empty text removes the key. */
export function saveDraft(sessionId: string, text: string, storage: Writer | undefined = safeStorage()): void {
  try {
    if (text) storage?.setItem(PREFIX + sessionId, text);
    else storage?.removeItem(PREFIX + sessionId);
  } catch {
    /* Storage can be full or blocked; the draft just isn't remembered. */
  }
}

/** Removes the drafts of chats that no longer exist. */
export function pruneDrafts(
  existingIds: Iterable<string>,
  storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | undefined = safeStorage(),
): void {
  try {
    if (!storage) return;
    const keep = new Set(existingIds);
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX) && !keep.has(key.slice(PREFIX.length))) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    /* Unreadable storage: leave the drafts alone. */
  }
}

export interface DraftSaver {
  /** Remembers the text for `sessionId` and writes it after the delay (a later call replaces it). */
  schedule(sessionId: string, text: string): void;
  /** Writes a pending draft now (chat switch, page hide). */
  flush(): void;
  /** Drops a pending draft without writing it. */
  cancel(): void;
}

/** Debounces `saveDraft`. The chat id travels with the pending text, so a flush after a switch writes to the right chat. */
export function createDraftSaver(
  save: (sessionId: string, text: string) => void = saveDraft,
  delayMs = SAVE_DELAY_MS,
): DraftSaver {
  let pending: { sessionId: string; text: string } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  const flush = () => {
    const draft = pending;
    cancel();
    if (draft) save(draft.sessionId, draft.text);
  };
  return {
    schedule(sessionId, text) {
      if (pending && pending.sessionId !== sessionId) flush();
      pending = { sessionId, text };
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel,
  };
}
