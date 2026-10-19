import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { EditorStore } from '../stores/editorStore.js';
import { draftReducer, isDirty, jsonKey, type DraftKey } from './draftState.js';

/**
 * The draft of the open item and the saved snapshot it started from, for the simple editors (characters,
 * personas, presets). `dirty` compares `key(draft)` with `key(saved)` (JSON by default); the saved key is computed
 * once per `load`, not per render. The open id and `dirty` are reported to the editor store.
 *
 * It does not apply the store's commands or register the saver: editors do that themselves
 * (`useEditorCommands`, `useEditorSaver`), because what "open" and "save" mean differs per editor.
 */
export function useDraft<T extends { id: string }>(store: EditorStore<T>, options?: { key?: DraftKey<T> }) {
  const [state, dispatch] = useReducer(draftReducer<T>, {});
  const key = options?.key ?? jsonKey;
  const latestKey = useRef(key);
  latestKey.current = key;
  const { draft, saved } = state;
  const savedKey = useMemo(() => (saved === undefined ? undefined : latestKey.current(saved)), [saved]);
  const dirty = isDirty(draft, savedKey, key);
  const openId = draft?.id;
  useEffect(() => store.report(openId, dirty), [store, openId, dirty]);
  const actions = useMemo(
    () => ({
      /** Edit the draft (ignored while nothing is open). */
      set: (next: T) => dispatch({ type: 'set', draft: next }),
      /** A saved item (opened, saved, reloaded from disk): draft and saved snapshot both become it. */
      load: (item: T) => dispatch({ type: 'load', item }),
      /** Back to the last saved item. */
      revert: () => dispatch({ type: 'revert' }),
      clear: () => dispatch({ type: 'clear' }),
    }),
    [],
  );
  return { draft, saved, savedKey, dirty, ...actions };
}
