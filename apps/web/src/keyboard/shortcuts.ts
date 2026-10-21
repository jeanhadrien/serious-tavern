/** Every keyboard shortcut, declared once: the source for a later help list or rebinding. */
export const SHORTCUTS = [
  { keys: 'Escape', scope: 'global', description: 'Close the innermost thing (see docs/dev/design/FRONTEND-UX.md)' },
  { keys: 'Mod+S', scope: 'editor', description: 'Save the editor you are in' },
  { keys: 'Mod+Z', scope: 'canvas', description: 'Undo on the workflow canvas (not inside a field)' },
  { keys: 'Mod+Shift+Z', scope: 'canvas', description: 'Redo on the workflow canvas (not inside a field)' },
  { keys: 'Mod+Y', scope: 'canvas', description: 'Redo on the workflow canvas (not inside a field)' },
  { keys: 'Mod+C', scope: 'canvas', description: 'Copy the selected nodes (not inside a field)' },
  { keys: 'Mod+V', scope: 'canvas', description: 'Paste copied nodes (not inside a field)' },
  { keys: '/', scope: 'canvas', description: 'Quick add: pick a node to add at the pointer (not inside a field)' },
] as const;

interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Shortcuts that act on the view with the keyboard (`useShortcutArea`), but never inside a field. */
export type AreaShortcut = 'undo' | 'redo' | 'quickAdd';
export type Shortcut = 'save' | AreaShortcut;
/**
 * Shortcuts that are the browser's native `copy` and `paste` events, not keys (`matchShortcut` never returns them): the
 * event carries the clipboard, needs no permission and also works from the menu. Same rules as the area shortcuts.
 */
export type ClipboardShortcut = 'copy' | 'paste';

/** The shortcut an event is, if any. `Mod` is Ctrl, or Cmd on macOS. */
export function matchShortcut(event: ShortcutEvent): Shortcut | undefined {
  // `/` is matched on the character, not the key position, and Shift is allowed: it is Shift+`:` on AZERTY.
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) return 'quickAdd';
  const mod = event.ctrlKey !== event.metaKey; // exactly one of them
  if (!mod || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 's' && !event.shiftKey) return 'save';
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
}

/**
 * Whether an area shortcut may act. A field that already handled the key, or any field at all (it keeps its own text
 * undo), and an open dialog (which handles its own keys) win over the view's shortcut.
 */
export function areaShortcutAllowed({
  handled,
  inDialog,
  inField,
}: {
  handled: boolean;
  inDialog: boolean;
  inField: boolean;
}): boolean {
  return !handled && !inDialog && !inField;
}
