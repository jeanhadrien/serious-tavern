interface KeyInput {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}

/**
 * Enter sends and Shift+Enter adds a line. Touch keyboards have no Shift+Enter, so there (`touch`) Enter adds a
 * line and the send button sends; Ctrl/Cmd+Enter still sends from a hardware keyboard.
 */
export function composerShouldSend(event: KeyInput, touch = false): boolean {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return false;
  return touch ? event.ctrlKey || event.metaKey : !event.shiftKey;
}

export function editorKeyAction(event: KeyInput): 'save' | 'cancel' | undefined {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') return 'cancel';
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) return 'save';
}
