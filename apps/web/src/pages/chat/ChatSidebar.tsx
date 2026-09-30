import type { SessionSummary } from '@st/shared';
import { Plus, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/IconButton.js';

interface ChatSidebarProps {
  sessions: SessionSummary[];
  activeId?: string;
  canCreate: boolean;
  disabled: boolean;
  onOpen: (id: string) => Promise<void>;
  onCreate: () => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function ChatSidebar({ sessions, activeId, canCreate, disabled, onOpen, onCreate, onDelete }: ChatSidebarProps) {
  return (
    <aside className="sidebar" aria-label="Chats">
      <div className="toolbar">
        <h2>Chats</h2>
        <button
          type="button"
          className="primary chat-new"
          onClick={() => void onCreate()}
          disabled={disabled || !canCreate}
        >
          <Plus size={18} aria-hidden="true" /> New
        </button>
      </div>
      {sessions.map((session) => (
        <div className={`session-row ${session.id === activeId ? 'selected' : ''}`} key={session.id}>
          <button
            type="button"
            className="session-link"
            disabled={disabled}
            aria-current={session.id === activeId ? 'page' : undefined}
            onClick={() => void onOpen(session.id)}
          >
            {session.title}
          </button>
          <IconButton
            icon={Trash2}
            label={`Delete chat: ${session.title}`}
            disabled={disabled}
            onClick={() => void onDelete(session.id)}
          />
        </div>
      ))}
    </aside>
  );
}
