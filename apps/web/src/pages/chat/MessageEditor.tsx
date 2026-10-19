import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';
import { editorKeyAction } from './keyboard.js';

interface MessageEditorProps {
  content: string;
  disabled: boolean;
  onSave: (content: string) => Promise<boolean>;
  onCancel: () => void;
}

export function MessageEditor({ content, disabled, onSave, onCancel }: MessageEditorProps) {
  const [draft, setDraft] = useState(content);
  const composing = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const save = () => {
    if (!disabled && draft.trim() && !composing.current) void onSave(draft.trim());
  };
  return (
    <div className="message-editor">
      <textarea
        ref={input}
        aria-label="Edit message"
        rows={5}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          const action = editorKeyAction({
            ...event,
            isComposing: composing.current || event.nativeEvent.isComposing,
            keyCode: event.nativeEvent.keyCode,
          });
          if (!action) return;
          if (action === 'save') {
            event.preventDefault();
            save();
          } else if (!disabled) {
            event.preventDefault(); // the field acted: the shell's Escape leaves it alone
            onCancel();
          }
        }}
      />
      <div className="message-editor-controls">
        <IconButton icon={Check} label="Save message" disabled={disabled || !draft.trim()} onClick={save} />
        <IconButton icon={X} label="Cancel editing" disabled={disabled} onClick={onCancel} />
        <small>{draft.trim() ? 'Ctrl/Cmd+Enter to save · Escape to cancel' : 'Message cannot be empty'}</small>
      </div>
    </div>
  );
}
