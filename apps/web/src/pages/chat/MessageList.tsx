import { useMemo } from 'react';
import type { Character, ChatMessage, ExecutionLog, Persona, SessionStateView } from '@st/shared';
import { ChatMessageView } from './ChatMessageView.js';
import { chipsFor, describeTurns } from './story/turnChips.js';
import { useStickToBottom } from './useStickToBottom.js';

interface MessageListProps {
  sessionId: string;
  messages: ChatMessage[];
  characters: Character[];
  persona?: Persona;
  logs: Record<string, ExecutionLog>;
  /** The chat's story state view, for the "What this turn stored" chips. */
  story?: SessionStateView;
  /** What deleting a message would undo of the story state; asked lazily, on the delete click. */
  undoOnDelete?: (messageId: string) => readonly string[] | undefined;
  busy: boolean;
  disabled: boolean;
  onEdit: (id: string, content: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

export function MessageList({
  sessionId,
  messages,
  characters,
  persona,
  logs,
  story,
  undoOnDelete,
  busy,
  disabled,
  onEdit,
  onDelete,
}: MessageListProps) {
  const { viewport, content, onScroll } = useStickToBottom(sessionId, messages);
  // The lines are described once per loaded view; placing the chips is one pass over the messages.
  const turns = useMemo(() => describeTurns(story), [story]);
  const chips = chipsFor(turns, messages);
  // Once a reply row is streaming the text itself is the progress indicator.
  const waiting = busy && !messages.some((message) => message.status === 'streaming');
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: A scrollable history region must be reachable for keyboard scrolling.
    <section ref={viewport} className="thread" onScroll={onScroll} aria-label="Message history" tabIndex={0}>
      <div ref={content}>
        {messages.map((message) => (
          <ChatMessageView
            key={message.id}
            message={message}
            character={characters.find((card) => card.id === message.characterId)}
            persona={persona}
            execution={message.executionId ? logs[message.executionId] : undefined}
            storyChip={chips.get(message.id)}
            undoOnDelete={undoOnDelete && (() => undoOnDelete(message.id))}
            disabled={disabled}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
        {waiting && (
          <div className="typing-indicator" role="status" aria-label="Workflow running">
            <span aria-hidden="true" className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            <small>Preparing a reply</small>
          </div>
        )}
      </div>
    </section>
  );
}
