import { useEffect, useRef } from 'react';
import { startPresetLiveSync, type LiveSyncOptions } from './presetLiveSync.js';

/** Starts the presets page's live sync for the lifetime of the component; `options` may change every render. */
export function usePresetLiveSync(options: LiveSyncOptions) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => startPresetLiveSync(() => latest.current), []);
}
