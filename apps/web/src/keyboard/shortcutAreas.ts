import { useEffect, useRef } from 'react';
import type { ViewKey } from '../layout/derive.js';
import type { AreaShortcut, ClipboardShortcut } from './shortcuts.js';

// Module-level like the Escape areas: one global listener (`useKeyboard`) finds the view with the keyboard and asks
// the handlers registered for it. A handler returns true when it acted, which also stops the browser's own action.

export type ShortcutHandlers = Partial<Record<AreaShortcut, () => boolean>> &
  Partial<Record<ClipboardShortcut, (event: ClipboardEvent) => boolean>>;

const areas = new Map<ViewKey, ShortcutHandlers[]>();

/** Registers handlers for a view; the returned function removes them. */
export function registerShortcutArea(view: ViewKey, handlers: ShortcutHandlers): () => void {
  const list = areas.get(view) ?? [];
  areas.set(view, list);
  list.push(handlers);
  return () => {
    const index = list.lastIndexOf(handlers);
    if (index >= 0) list.splice(index, 1);
  };
}

/** Runs a view's handlers for a shortcut, newest first, until one returns true. */
export function runShortcut(view: ViewKey, shortcut: AreaShortcut): boolean {
  for (const handlers of [...(areas.get(view) ?? [])].reverse()) if (handlers[shortcut]?.()) return true;
  return false;
}

/** Runs a view's `copy` or `paste` handlers like `runShortcut`; a handler that acts uses the event's `clipboardData`. */
export function runClipboard(view: ViewKey, shortcut: ClipboardShortcut, event: ClipboardEvent): boolean {
  for (const handlers of [...(areas.get(view) ?? [])].reverse()) if (handlers[shortcut]?.(event)) return true;
  return false;
}

/**
 * Declares what the area shortcuts do in a layout view. The handlers may change every render; the latest ones are
 * used. Only the shortcuts given are claimed.
 */
export function useShortcutArea(view: ViewKey, handlers: ShortcutHandlers) {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(
    () =>
      registerShortcutArea(view, {
        undo: () => latest.current.undo?.() ?? false,
        redo: () => latest.current.redo?.() ?? false,
        quickAdd: () => latest.current.quickAdd?.() ?? false,
        copy: (event) => latest.current.copy?.(event) ?? false,
        paste: (event) => latest.current.paste?.(event) ?? false,
      }),
    [view],
  );
}
