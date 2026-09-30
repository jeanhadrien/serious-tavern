interface KeyInput {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}

export function composerShouldSend(event: KeyInput): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

export function editorKeyAction(event: KeyInput): 'save' | 'cancel' | undefined {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') return 'cancel';
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) return 'save';
}
