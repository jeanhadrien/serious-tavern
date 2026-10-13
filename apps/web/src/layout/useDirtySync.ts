import { useEffect, type Dispatch } from 'react';
import type { LayoutAction, ResourceId } from './state.js';

/** The part of an editor store the shell needs. */
interface DirtySource {
  getSnapshot(): { dirty: boolean };
  subscribe(listener: () => void): () => void;
}

/** Mirrors each editor's unsaved-changes flag into the layout state, which shows it as a dot on its icon. */
export function useDirtySync(sources: Partial<Record<ResourceId, DirtySource>>, dispatch: Dispatch<LayoutAction>) {
  useEffect(() => {
    const stops = Object.entries(sources).map(([id, source]) => {
      const sync = () => dispatch({ type: 'setDirty', id: id as ResourceId, dirty: source.getSnapshot().dirty });
      sync();
      return source.subscribe(sync);
    });
    return () => {
      for (const stop of stops) stop();
    };
  }, [sources, dispatch]);
}
