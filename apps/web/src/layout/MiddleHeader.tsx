import type { ReactNode } from 'react';
import { MessageSquare, PencilLine, X } from 'lucide-react';
import { IconButton } from '../components/IconButton.js';
import type { ResourceId } from './state.js';
import { VIEW_INFO } from './views.js';

interface MiddleHeaderProps {
  /** The wide editor owning M, if any. */
  editor?: ResourceId;
  /** Two-column mode: the chat can be toggled in over the editor. */
  compact: boolean;
  chatShown: boolean;
  onClose: (id: ResourceId) => void;
  onToggleChat: () => void;
  /** Phone mode: the menu button, shown before the title. */
  menu?: ReactNode;
  /** Phone mode: the name of a list shown instead of M's content. */
  title?: string;
}

/** The title bar over M: the open wide editor with its close button, or just the chat. */
export function MiddleHeader({ editor, compact, chatShown, onClose, onToggleChat, menu, title }: MiddleHeaderProps) {
  return (
    <header className="middle-header" style={{ gridArea: 'mh' }}>
      <span className="middle-title">
        {menu}
        <strong>{title ?? (editor ? VIEW_INFO[editor].label : VIEW_INFO.chat.label)}</strong>
      </span>
      {editor && (
        <span className="middle-actions">
          {compact && (
            <IconButton
              icon={chatShown ? PencilLine : MessageSquare}
              label={chatShown ? `Show ${VIEW_INFO[editor].label}` : 'Show chat'}
              onClick={onToggleChat}
            />
          )}
          <IconButton icon={X} label={`Close ${VIEW_INFO[editor].label}`} onClick={() => onClose(editor)} />
        </span>
      )}
    </header>
  );
}
