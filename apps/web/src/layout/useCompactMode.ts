import { useSyncExternalStore } from 'react';

/** Below this viewport width the shell collapses from L | M | R to L | M. */
const COMPACT_BREAKPOINT = 1000;
/** Below this viewport width (phones) the shell shows one column at a time, switched from a menu. */
const MOBILE_BREAKPOINT = 700;

function useMaxWidth(breakpoint: number): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Whether the viewport is below the two-column breakpoint. */
export const useCompactMode = (): boolean => useMaxWidth(COMPACT_BREAKPOINT);

/** Whether the viewport is below the single-column (phone) breakpoint. */
export const useMobileMode = (): boolean => useMaxWidth(MOBILE_BREAKPOINT);
