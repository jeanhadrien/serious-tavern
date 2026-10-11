import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Runs `onActive` when the tab at `path` becomes visible again (not on the
 * initial mount, where pages load their own data). Tabs stay mounted while
 * other tabs are open, so shared catalogs are refreshed on return instead of
 * on mount.
 */
export function useRefreshOnTabActive(path: string, onActive: () => void) {
  const { pathname } = useLocation();
  const active = pathname === path;
  const callback = useRef(onActive);
  callback.current = onActive;
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) callback.current();
    wasActive.current = active;
  }, [active]);
}
