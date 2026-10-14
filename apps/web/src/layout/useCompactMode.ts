import { useMediaQuery } from '../useMediaQuery.js';

/** Below this viewport width the shell collapses from L | M | R to L | M. */
const COMPACT_BREAKPOINT = 1000;
/** Below this viewport width (phones) the shell shows one column at a time, switched from a menu. */
const MOBILE_BREAKPOINT = 700;

/** Whether the viewport is below the two-column breakpoint. */
export const useCompactMode = (): boolean => useMediaQuery(`(max-width: ${COMPACT_BREAKPOINT - 1}px)`);

/** Whether the viewport is below the single-column (phone) breakpoint. */
export const useMobileMode = (): boolean => useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
