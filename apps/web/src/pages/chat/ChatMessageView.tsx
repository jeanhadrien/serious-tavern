import { useLayoutEffect, useRef, useState } from 'react';
import type { Character, ChatMessage, ExecutionLog, Persona } from '@st/shared';
import { Bot, User } from 'lucide-react';
import { charactersApi, personasApi } from '../../api.js';
import { ExecutionDetails } from './ExecutionDetails.js';
import { MessageContent } from './MessageContent.js';
import { MessageActions } from './MessageActions.js';
import { MessageEditor } from './MessageEditor.js';
import { TurnChip } from './story/TurnChip.js';
import type { StoryChip } from './story/turnChips.js';

interface ChatMessageViewProps {
  message: ChatMessage;
  character?: Character;
  persona?: Persona;
  execution?: ExecutionLog;
  /** What the message's turn stored in the chat's story state (only on the last reply of a turn that stored any). */
  storyChip?: StoryChip;
  disabled?: boolean;
  onEdit?: (id: string, content: string) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
}

export function ChatMessageView({
  message,
  character,
  persona,
  execution,
  storyChip,
  disabled = false,
  onEdit,
  onDelete,
}: ChatMessageViewProps) {
  const [editing, setEditing] = useState(false);
  const bubble = useRef<HTMLElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (!editing && !disabled && restoreFocus.current) {
      bubble.current?.querySelector<HTMLButtonElement>('[aria-label="Edit message"]')?.focus();
      restoreFocus.current = false;
    }
  }, [editing, disabled]);
  const user = message.role === 'user';
  const streaming = message.status === 'streaming';
  const name = user ? persona?.name || 'You' : message.name || 'Assistant';
  const avatar = user
    ? typeof persona?.avatar === 'string'
      ? personasApi.avatarUrl(persona.id)
      : undefined
    : message.characterId && typeof character?.avatar === 'string'
      ? charactersApi.avatarUrl(message.characterId)
      : undefined;
  const closeEditor = () => {
    restoreFocus.current = true;
    setEditing(false);
  };
  return (
    <article
      ref={bubble}
      className={`message ${message.role}${editing ? ' editing' : ''}${streaming ? ' streaming' : ''}`}
      aria-label={`${name} message`}
      data-execution-id={message.executionId}
    >
      <div className="message-top">
        <div className="message-speaker">
          {avatar ? (
            <img src={avatar} alt="" width={28} height={28} />
          ) : (
            <span className="message-avatar">{user ? <User size={18} /> : <Bot size={18} />}</span>
          )}
          <strong>{name}</strong>
          <small>{user ? 'User' : 'Assistant'}</small>
        </div>
        {onEdit && onDelete && (
          <MessageActions
            disabled={disabled || editing}
            onEdit={() => setEditing(true)}
            onDelete={() => onDelete(message.id)}
          />
        )}
      </div>
      {editing && onEdit ? (
        <MessageEditor
          content={message.content}
          disabled={disabled}
          onCancel={closeEditor}
          onSave={async (content) => {
            const saved = await onEdit(message.id, content);
            if (saved) closeEditor();
            return saved;
          }}
        />
      ) : (
        <>
          {message.reasoning && (
            // Open while the model is still thinking (no answer text yet) so the stream is visible.
            <details className="message-reasoning" open={streaming && !message.content ? true : undefined}>
              <summary>Reasoning</summary>
              <pre>{message.reasoning}</pre>
            </details>
          )}
          <MessageContent content={message.content} />
          {message.status === 'partial' && <small className="message-stopped">Stopped before it finished</small>}
        </>
      )}
      {storyChip && !editing && <TurnChip chip={storyChip} />}
      {message.executionId && <ExecutionDetails id={message.executionId} cached={execution} />}
    </article>
  );
}
