import { useSyncExternalStore } from 'react';

/** Below this viewport width the shell collapses from L | M | R to L | M. */
const COMPACT_BREAKPOINT = 1000;

const QUERY = `(max-width: ${COMPACT_BREAKPOINT - 1}px)`;

const subscribe = (notify: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};

/** Whether the viewport is below the two-column breakpoint. */
export function useCompactMode(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
