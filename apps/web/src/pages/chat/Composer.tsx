import { useLayoutEffect, useRef } from 'react';
import { LoaderCircle, Send } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { composerShouldSend } from './keyboard.js';

interface ComposerProps {
  content: string;
  busy: boolean;
  onChange: (content: string) => void;
  onSend: () => Promise<void>;
}

export function Composer({ content, busy, onChange, onSend }: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [content]);
  useLayoutEffect(() => {
    if (!busy && restoreFocus.current) {
      input.current?.focus();
      restoreFocus.current = false;
    }
  }, [busy]);
  const send = () => {
    if (busy || composing.current || !content.trim()) return;
    restoreFocus.current = true;
    input.current?.focus();
    void onSend();
  };
  return (
    <form
      className={`composer${busy ? ' is-busy' : ''}`}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        ref={input}
        rows={1}
        aria-label="Message"
        aria-disabled={busy}
        readOnly={busy}
        placeholder={busy ? 'Waiting for the workflow…' : 'Write a message…'}
        value={content}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            composerShouldSend({
              ...event,
              isComposing: composing.current || event.nativeEvent.isComposing,
              keyCode: event.nativeEvent.keyCode,
            })
          ) {
            event.preventDefault();
            send();
          }
        }}
      />
      <IconButton
        icon={busy ? LoaderCircle : Send}
        label={busy ? 'Workflow running' : 'Send message'}
        className={`primary${busy ? ' spinning' : ''}`}
        disabled={busy || !content.trim()}
        onClick={send}
      />
      <small className="composer-hint">Enter to send · Shift+Enter for a new line</small>
    </form>
  );
}
