/** Every keyboard shortcut, declared once: the source for a later help list or rebinding. */
export const SHORTCUTS = [
  { keys: 'Escape', scope: 'global', description: 'Close the innermost thing (see docs/FRONTEND-UX.md)' },
  { keys: 'Mod+S', scope: 'editor', description: 'Save the editor you are in' },
] as const;

interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The shortcut an event is, if any. `Mod` is Ctrl, or Cmd on macOS. */
export function matchShortcut(event: ShortcutEvent): 'save' | undefined {
  const mod = event.ctrlKey !== event.metaKey; // exactly one of them
  if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') return 'save';
}
