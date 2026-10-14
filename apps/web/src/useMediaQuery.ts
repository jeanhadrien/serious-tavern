import { useCallback, useSyncExternalStore } from 'react';

/** Whether a CSS media query matches, kept live. False during server rendering (tests). */
export function useMediaQuery(query: string): boolean {
  // A stable subscribe: a new one each render would make React resubscribe on every render, and the shell
  // re-renders on every streamed token.
  const subscribe = useCallback(
    (notify: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
