import { memo } from 'react';
import { X } from 'lucide-react';
import type { Workflow } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { SettingsSection, type SaveSettings } from './panel/SettingsSection.js';
import './chatPanel.css';

/**
 * The chat's side panel, inside the chat view (not a layout view). It holds per-chat sections: chat settings
 * now; story state and summaries later. Memoized because the chat re-renders on every streamed token.
 */
export const ChatPanel = memo(function ChatPanel({
  workflow,
  stored,
  sessionId,
  onSave,
  onClose,
}: {
  workflow?: Workflow;
  stored?: Record<string, unknown>;
  sessionId: string;
  onSave: SaveSettings;
  onClose(): void;
}) {
  return (
    <aside className="chat-panel" aria-label="Chat panel">
      <div className="chat-panel-header">
        <h2>Chat panel</h2>
        <IconButton icon={X} label="Close chat panel" onClick={onClose} />
      </div>
      <section aria-labelledby={`chat-settings-${sessionId}`}>
        <h3 id={`chat-settings-${sessionId}`}>Settings</h3>
        <SettingsSection workflow={workflow} stored={stored} sessionId={sessionId} onSave={onSave} />
      </section>
    </aside>
  );
});
