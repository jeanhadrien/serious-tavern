import type { Character, ChatMessage, ExecutionLog, Persona } from '@st/shared';
import { ChatMessageView } from './ChatMessageView.js';
import { useStickToBottom } from './useStickToBottom.js';

interface MessageListProps {
  sessionId: string;
  messages: ChatMessage[];
  characters: Character[];
  persona?: Persona;
  logs: Record<string, ExecutionLog>;
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
  busy,
  disabled,
  onEdit,
  onDelete,
}: MessageListProps) {
  const { viewport, content, onScroll } = useStickToBottom(sessionId, messages);
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
