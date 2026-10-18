import { memo, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import type { Workflow } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { SettingsSection, type SaveSettings } from './panel/SettingsSection.js';
import { panelCoversThread, scrollToMessage, scrollToTurn } from './story/scrollToTurn.js';
import { SummariesSection } from './story/SummariesSection.js';
import { StorySection } from './story/StorySection.js';
import type { StoryPanelData } from './story/useStoryState.js';
import './chatPanel.css';

/**
 * The chat's side panel, inside the chat view (not a layout view). It holds per-chat sections: chat settings, story
 * state and history summaries (both read the one state view in `story`). Memoized because the chat re-renders on
 * every streamed token: every prop keeps its identity between tokens (`story` is only replaced when the loaded view
 * changes).
 */
export const ChatPanel = memo(function ChatPanel({
  workflow,
  stored,
  sessionId,
  story,
  onSave,
  onClose,
}: {
  workflow?: Workflow;
  stored?: Record<string, unknown>;
  sessionId: string;
  story: StoryPanelData;
  onSave: SaveSettings;
  onClose(): void;
}) {
  const panel = useRef<HTMLElement>(null);
  // Over a narrow chat the panel covers the messages: close it after the jump so the reply is visible.
  const jump = useCallback(
    (executionId: string) => {
      if (scrollToTurn(executionId) && panelCoversThread(panel.current)) onClose();
    },
    [onClose],
  );
  const jumpToMessage = useCallback(
    (messageId: string) => {
      if (scrollToMessage(messageId) && panelCoversThread(panel.current)) onClose();
    },
    [onClose],
  );
  return (
    <aside ref={panel} className="chat-panel" aria-label="Chat panel">
      <div className="chat-panel-header">
        <h2>Chat panel</h2>
        <IconButton icon={X} label="Close chat panel" onClick={onClose} />
      </div>
      <section aria-labelledby={`chat-settings-${sessionId}`}>
        <h3 id={`chat-settings-${sessionId}`}>Settings</h3>
        <SettingsSection workflow={workflow} stored={stored} sessionId={sessionId} onSave={onSave} />
      </section>
      <section aria-labelledby={`chat-story-${sessionId}`}>
        <h3 id={`chat-story-${sessionId}`}>Story state</h3>
        <StorySection story={story} onJump={jump} />
      </section>
      <section aria-labelledby={`chat-summaries-${sessionId}`}>
        <h3 id={`chat-summaries-${sessionId}`}>Summaries</h3>
        <SummariesSection story={story} onJump={jumpToMessage} />
      </section>
    </aside>
  );
});
