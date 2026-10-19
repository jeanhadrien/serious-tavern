import { useEffect } from 'react';

/** The `beforeunload` handler: asks the browser for its own "leave site?" warning. */
export function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = '';
}

/** While `dirty`, closing or reloading the tab triggers the browser's "leave site?" warning. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);
}
