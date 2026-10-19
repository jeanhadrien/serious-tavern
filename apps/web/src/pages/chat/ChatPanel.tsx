import { memo, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import type { Workflow } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { Splitter } from '../../components/splitter/Splitter.js';
import { useStoredSize } from '../../components/splitter/useStoredSize.js';
import { SettingsSection, type SaveSettings } from './panel/SettingsSection.js';
import { closesPanelAfter, scrollToItem, scrollToMessage, scrollToTurn } from './story/scrollToTurn.js';
import { StorySection } from './story/StorySection.js';
import type { StoryPanelData } from './story/useStoryState.js';
import './chatPanel.css';

/** A request to show a state item in the panel; a new object (`n` counts) each time, so asking again repeats it. */
export type Reveal = { itemId: string; n: number };

const WIDTH = { initial: 320, min: 260, max: 640 };

/**
 * The chat's side panel, inside the chat view (not a layout view). It holds per-chat sections: chat settings and
 * story state. Memoized because the chat re-renders on every streamed token: every prop keeps
 * its identity between tokens (`story` is only replaced when the loaded view changes). Its width is state of its own
 * (remembered per browser) and reaches the CSS as `--chat-panel-width`; only the side-by-side rule reads it.
 */
export const ChatPanel = memo(function ChatPanel({
  workflow,
  stored,
  sessionId,
  story,
  reveal,
  onRevealed,
  onSave,
  onClose,
}: {
  workflow?: Workflow;
  stored?: Record<string, unknown>;
  sessionId: string;
  story: StoryPanelData;
  /** A state item to scroll to once the panel shows it (a "Show in Story state" click on a message's marker). */
  reveal?: Reveal;
  onRevealed(): void;
  onSave: SaveSettings;
  onClose(): void;
}) {
  const panel = useRef<HTMLElement>(null);
  const width = useStoredSize('chat-panel', WIDTH);
  // Over a narrow chat the panel covers the messages: close it after the jump so the reply is visible.
  const jump = useCallback(
    (executionId: string) => {
      if (closesPanelAfter(scrollToTurn(executionId), panel.current)) onClose();
    },
    [onClose],
  );
  const jumpToMessage = useCallback(
    (messageId: string) => {
      if (closesPanelAfter(scrollToMessage(messageId), panel.current)) onClose();
    },
    [onClose],
  );
  // The view may still be loading when the panel opens, so it tries again when the view arrives; once it has scrolled
  // the request is cleared, so reopening the panel later does not repeat it.
  useEffect(() => {
    if (reveal && scrollToItem(reveal.itemId)) onRevealed();
  }, [reveal, story.view, onRevealed]);
  return (
    <>
      <Splitter
        className="splitter-inline chat-panel-splitter"
        label="Resize chat panel"
        value={width.size}
        min={WIDTH.min}
        max={WIDTH.max}
        direction={-1}
        onChange={width.setSize}
        onReset={width.reset}
      />
      <aside
        ref={panel}
        className="chat-panel"
        aria-label="Chat panel"
        style={{ '--chat-panel-width': `${width.size}px` } as CSSProperties}
      >
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
          <StorySection story={story} onJump={jump} onJumpMessage={jumpToMessage} />
        </section>
      </aside>
    </>
  );
});
