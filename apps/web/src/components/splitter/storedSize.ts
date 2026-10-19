import { safeStorage } from '../../safeStorage.js';

const PREFIX = 'st.size.';

export const clampSize = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem' | 'removeItem'>;

/** A remembered size, or `fallback` when none is stored or the stored value is not a finite number. */
export function loadSize<T>(key: string, fallback: T, storage: Reader | undefined = safeStorage()): number | T {
  try {
    const raw = storage?.getItem(PREFIX + key);
    const value = raw === null || raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback; // Unreadable storage: the size just isn't remembered.
  }
}

export function saveSize(key: string, value: number, storage: Writer | undefined = safeStorage()): void {
  try {
    storage?.setItem(PREFIX + key, String(value));
  } catch {
    /* Storage can be full or blocked; the size just isn't remembered. */
  }
}

export function clearSize(key: string, storage: Writer | undefined = safeStorage()): void {
  try {
    storage?.removeItem(PREFIX + key);
  } catch {
    /* Nothing to forget when storage is blocked. */
  }
}
