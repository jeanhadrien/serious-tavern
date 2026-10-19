import { memo, useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import type { ReplyEntry, Workflow } from '@st/shared';
import { IconButton } from '../../components/IconButton.js';
import { Splitter } from '../../components/splitter/Splitter.js';
import { useStoredSize } from '../../components/splitter/useStoredSize.js';
import { listedWorkflows } from './panel/replyList.js';
import { ReplySection } from './panel/ReplySection.js';
import { SettingsSection, type SaveSettings } from './panel/SettingsSection.js';
import type { SaveReplyList } from './panel/useReplyList.js';
import { closesPanelAfter, scrollToItem, scrollToMessage, scrollToTurn } from './story/scrollToTurn.js';
import { StorySection } from './story/StorySection.js';
import type { StoryPanelData } from './story/useStoryState.js';
import './chatPanel.css';

/** A request to show a state item in the panel; a new object (`n` counts) each time, so asking again repeats it. */
export type Reveal = { itemId: string; n: number };

const WIDTH = { initial: 320, min: 260, max: 640 };

/**
 * The chat's side panel, inside the chat view (not a layout view). It holds per-chat sections: the reply list (On
 * reply), chat settings and story state. Memoized because the chat re-renders on every streamed token: every prop keeps
 * its identity between tokens (`story` is only replaced when the loaded view changes). Its width is state of its own
 * (remembered per browser) and reaches the CSS as `--chat-panel-width`; only the side-by-side rule reads it.
 */
export const ChatPanel = memo(function ChatPanel({
  workflows,
  replyList,
  stored,
  sessionId,
  story,
  reveal,
  onRevealed,
  onSave,
  onSaveReply,
  onClose,
}: {
  /** Every workflow (the store's list). */
  workflows: readonly Workflow[];
  /** The chat's saved reply list (`replyWorkflows`); keeps its identity until the stored list changes. */
  replyList: readonly ReplyEntry[];
  stored?: Record<string, unknown>;
  sessionId: string;
  story: StoryPanelData;
  /** A state item to scroll to once the panel shows it (a "Show in Story state" click on a message's marker). */
  reveal?: Reveal;
  onRevealed(): void;
  onSave: SaveSettings;
  onSaveReply: SaveReplyList;
  onClose(): void;
}) {
  const panel = useRef<HTMLElement>(null);
  const width = useStoredSize('chat-panel', WIDTH);
  // Settings follow the saved list, not a change still being saved: the server checks values against the saved one.
  const listed = useMemo(() => listedWorkflows(replyList, workflows), [replyList, workflows]);
  // Node memory names its workflow only when there are several to tell apart.
  const workflowNames = useMemo(
    () => (listed.length > 1 ? new Map(listed.map((workflow) => [workflow.id, workflow.name])) : undefined),
    [listed],
  );
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
        <section aria-labelledby={`chat-reply-${sessionId}`}>
          <h3 id={`chat-reply-${sessionId}`}>On reply</h3>
          <ReplySection sessionId={sessionId} workflows={workflows} stored={replyList} onSave={onSaveReply} />
        </section>
        <section aria-labelledby={`chat-settings-${sessionId}`}>
          <h3 id={`chat-settings-${sessionId}`}>Settings</h3>
          <SettingsSection workflows={listed} stored={stored} sessionId={sessionId} onSave={onSave} />
        </section>
        <section aria-labelledby={`chat-story-${sessionId}`}>
          <h3 id={`chat-story-${sessionId}`}>Story state</h3>
          <StorySection story={story} workflowNames={workflowNames} onJump={jump} onJumpMessage={jumpToMessage} />
        </section>
      </aside>
    </>
  );
});
