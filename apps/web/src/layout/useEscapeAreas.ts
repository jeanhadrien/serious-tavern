import { useEffect, useRef } from 'react';
import { registerArea } from '../keyboard/escapeRegistry.js';
import type { ViewKey } from './derive.js';
import { LISTLESS, RESOURCE_IDS, type LayoutState, type ResourceId } from './state.js';

/** The editors that close back to a list. Settings has none. */
const CLOSABLE = RESOURCE_IDS.filter((id) => !LISTLESS.includes(id));

/** Focuses the list's selected row, else the list's view. Does nothing when the list is not on screen. */
function focusList(list: ViewKey) {
  const section = document.querySelector<HTMLElement>(`section.view[data-view="${list}"]`);
  if (!section || section.hidden) return;
  const row = section.querySelector<HTMLElement>('.selected');
  const target = row?.matches('button, a[href]') ? row : row?.querySelector<HTMLElement>('button, a[href]');
  (target ?? section).focus();
}

/**
 * The default Escape of every editor view: close it (a narrow one goes back to its list, a wide one gives M back to
 * the chat). The draft is kept, since editors stay mounted. Pages add their inner layers with `useEscapeArea`, which
 * run first. Focus then goes to the list's selected row, once the layout has put the list on screen.
 */
export function useDefaultEscapeAreas(layout: LayoutState, closeEditor: (id: ResourceId) => void) {
  const close = useRef(closeEditor);
  close.current = closeEditor;
  const focusAfter = useRef<ViewKey | undefined>(undefined);
  useEffect(() => {
    const offs = CLOSABLE.map((id) =>
      registerArea(
        `editor:${id}`,
        () => {
          focusAfter.current = `list:${id}` as ViewKey;
          close.current(id);
          return true;
        },
        true,
      ),
    );
    return () => {
      for (const off of offs) off();
    };
  }, []);
  // Runs after the render that the close caused.
  useEffect(() => {
    const list = focusAfter.current;
    focusAfter.current = undefined;
    if (list) focusList(list);
  }, [layout]);
}
