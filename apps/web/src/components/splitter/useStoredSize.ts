import { useCallback, useState } from 'react';
import { clampSize, clearSize, loadSize, saveSize } from './storedSize.js';

/**
 * A size (pixels) the user can change and the browser remembers under `key`. Only the user's own value is stored:
 * `initial` is the default until then (and again after `reset`), so it may differ between renders. The size is
 * always within `min`..`max`.
 */
export function useStoredSize(key: string, { initial, min, max }: { initial: number; min: number; max: number }) {
  const [stored, setStored] = useState(() => loadSize<number | undefined>(key, undefined));
  const setSize = useCallback(
    (next: number) => {
      const value = Math.round(clampSize(next, min, max));
      setStored(value);
      saveSize(key, value);
    },
    [key, min, max],
  );
  const reset = useCallback(() => {
    setStored(undefined);
    clearSize(key);
  }, [key]);
  return { size: clampSize(stored ?? initial, min, max), setSize, reset };
}
