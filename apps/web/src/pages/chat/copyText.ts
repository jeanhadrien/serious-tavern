import { alerts } from '../../alerts/index.js';

const COPIED_TOAST_MS = 1500;

type Clipboard = Pick<globalThis.Clipboard, 'writeText'>;

/** Copies a message's raw text (Markdown) and says how it went; a missing or refusing clipboard is an error toast. */
export async function copyMessageText(
  text: string,
  clipboard: Clipboard | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard,
): Promise<boolean> {
  try {
    if (!clipboard) throw new Error('No clipboard');
    await clipboard.writeText(text);
    alerts.success('Copied', { timeoutMs: COPIED_TOAST_MS });
    return true;
  } catch {
    alerts.error('Could not copy the message');
    return false;
  }
}
