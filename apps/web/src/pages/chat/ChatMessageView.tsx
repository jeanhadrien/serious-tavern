import { useLayoutEffect, useRef, useState } from 'react';
import type { Character, ChatMessage, ExecutionLog, Persona } from '@st/shared';
import { Bot, User } from 'lucide-react';
import { charactersApi, personasApi } from '../../api.js';
import { AlternativeControls, type AlternativeControlsProps } from './AlternativeControls.js';
import { ExecutionDetails } from './ExecutionDetails.js';
import { MessageContent } from './MessageContent.js';
import { MessageActions } from './MessageActions.js';
import { MessageEditor } from './MessageEditor.js';
import { useLinkMarker } from './story/LinkMarker.js';
import { changeNote, type MessageLinkNote } from './story/linkMarkers.js';
import { TurnChip } from './story/TurnChip.js';
import { messageLogId } from './turnMessages.js';
import type { StoryChip } from './story/turnChips.js';

interface ChatMessageViewProps {
  message: ChatMessage;
  character?: Character;
  persona?: Persona;
  execution?: ExecutionLog;
  /** What the message's turn stored in the chat's story state (only on the last reply of a turn that stored any). */
  storyChip?: StoryChip;
  /** The story state items that link to this message (see `messageLinks`). */
  links?: readonly MessageLinkNote[];
  /** What deleting the message would undo of the story state (see `MessageActions`). */
  undoOnDelete?: () => readonly string[] | undefined;
  /** Regenerate and swipe controls: given only to the last reply of the last turn. */
  alternatives?: AlternativeControlsProps;
  /** Forks the chat after this reply: given only to fork points (see `forkPoints`). */
  onFork?: (id: string) => void;
  /** The Fork button waits for a run after the reply, which the server would refuse to fork under. */
  forkDisabled?: boolean;
  disabled?: boolean;
  onEdit?: (id: string, content: string) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
  onShowLinked?: (itemId: string) => void;
}

/** What an edit or delete of this message stops, said before it is saved (information, not a confirmation step). */
export function LinkNote({ note }: { note?: string }) {
  return note ? (
    <p className="hint warning message-link-note" role="status">
      {note}
    </p>
  ) : null;
}

export function ChatMessageView({
  message,
  character,
  persona,
  execution,
  storyChip,
  links,
  undoOnDelete,
  alternatives,
  onFork,
  forkDisabled,
  disabled = false,
  onEdit,
  onDelete,
  onShowLinked,
}: ChatMessageViewProps) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const marker = useLinkMarker(links, onShowLinked);
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
  // The log of the run that wrote the message (older messages: the turn's). A row still streaming has none saved yet,
  // though it already carries its run id.
  const logId = streaming ? undefined : messageLogId(message);
  // Copy takes the stored text (Markdown), never the reasoning; a streaming row is not stored yet.
  const copyable = !streaming && message.content.length > 0;
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
      data-message-id={message.id}
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
          {!editing && marker.button}
        </div>
        {(copyable || onFork || (onEdit && onDelete)) && (
          <MessageActions
            disabled={disabled || editing}
            copyText={copyable ? message.content : undefined}
            onFork={onFork && (() => onFork(message.id))}
            forkDisabled={forkDisabled}
            onEdit={onEdit && onDelete ? () => setEditing(true) : undefined}
            onDelete={onEdit && onDelete ? () => onDelete(message.id) : undefined}
            undoOnDelete={undoOnDelete}
            onConfirming={setDeleting}
            deleteNote={changeNote(links, 'delete')}
          />
        )}
      </div>
      {!editing && marker.card}
      {(editing || deleting) && <LinkNote note={changeNote(links, editing ? 'edit' : 'delete')} />}
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
      {alternatives && !editing && <AlternativeControls {...alternatives} />}
      {storyChip && !editing && <TurnChip chip={storyChip} />}
      {logId && <ExecutionDetails id={logId} cached={execution} />}
    </article>
  );
}
