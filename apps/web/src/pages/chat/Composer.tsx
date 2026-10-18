import { useLayoutEffect, useRef } from 'react';
import { Send, Square } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { useMediaQuery } from '../../useMediaQuery.js';
import { composerShouldSend } from './keyboard.js';

interface ComposerProps {
  content: string;
  busy: boolean;
  /** The message waits behind an after-reply run: the button cancels it instead of stopping a generation. */
  queued?: boolean;
  locked: boolean;
  onChange: (content: string) => void;
  onSend: () => Promise<void>;
  onStop: () => void;
}

export function Composer({ content, busy, queued = false, locked, onChange, onSend, onStop }: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const restoreFocus = useRef(false);
  // A touch screen's main pointer is a finger: its on-screen keyboard has no Shift+Enter.
  const touch = useMediaQuery('(pointer: coarse)');
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
    if (locked || composing.current) return;
    restoreFocus.current = true;
    input.current?.focus();
    void onSend();
  };
  return (
    <form
      className={`composer${locked ? ' is-busy' : ''}`}
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
        aria-disabled={locked}
        readOnly={locked}
        placeholder={
          busy
            ? queued
              ? 'Waiting for the after-reply steps… Esc to cancel'
              : 'Generating… Esc to stop'
            : 'Write a message… (empty to generate a reply)'
        }
        value={content}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (busy && event.key === 'Escape') {
            onStop();
            return;
          }
          if (
            composerShouldSend(
              {
                ...event,
                isComposing: composing.current || event.nativeEvent.isComposing,
                keyCode: event.nativeEvent.keyCode,
              },
              touch,
            )
          ) {
            event.preventDefault();
            send();
          }
        }}
      />
      <IconButton
        icon={busy ? Square : Send}
        label={busy ? (queued ? 'Cancel queued message' : 'Stop generation') : 'Send message'}
        className={`primary${busy ? ' stop-generation' : ''}`}
        disabled={!busy && locked}
        onClick={busy ? onStop : send}
      />
      <small className="composer-hint">
        {touch ? 'Enter for a new line · tap Send to send' : 'Enter to send · Shift+Enter for a new line'}
      </small>
    </form>
  );
}
