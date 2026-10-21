import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { Character, ChatMessage, ExecutionLog, LastTurnAlternatives, Persona, SessionStateView } from '@st/shared';
import { ChatMessageView } from './ChatMessageView.js';
import type { MessageStatsMap } from './useMessageStats.js';
import { messageLinks } from './story/linkMarkers.js';
import { runningPostRun } from './story/postRuns.js';
import { POST_WAITING_LABEL } from './story/postRunText.js';
import { chipsFor, describeTurns } from './story/turnChips.js';
import { messageLogId } from './turnMessages.js';
import { useStickToBottom } from './useStickToBottom.js';

interface MessageListProps {
  sessionId: string;
  /** The messages in the chat: the shared `activeMessages` of the session's (inactive alternatives are not shown). */
  messages: ChatMessage[];
  characters: Character[];
  persona?: Persona;
  logs: Record<string, ExecutionLog>;
  /** The chat's story state view, for the "What this turn stored" chips. */
  story?: SessionStateView;
  /** The replies' text statistics by message id; none while the app setting is off. Each message gets its own entry. */
  stats?: MessageStatsMap;
  /** What deleting a message would undo of the story state; asked lazily, on the delete click. */
  undoOnDelete?: (messageId: string) => readonly string[] | undefined;
  busy: boolean;
  /** The workflow whose run is starting, when the chat runs several (the waiting indicator names it). */
  runningWorkflow?: string;
  disabled: boolean;
  onEdit: (id: string, content: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  /**
   * The last turn's alternatives (`alternativesOfLastTurn` over ALL the session's messages: the inactive ones are
   * what make an alternative), or none while a run is in flight. Only its `lastReplyId` message gets the controls.
   */
  lastTurn?: LastTurnAlternatives | null;
  /** Runs the last turn again; shown with the swipe controls on the last reply of the last turn. */
  onRegenerate: () => void;
  /** Shows another alternative of the last turn (by its `executionId`); true when it was saved. */
  onSwipe: (executionId: string) => Promise<boolean>;
  /** The ids of the replies a fork may start from (`forkPoints` over `messages`); only these get the Fork button. */
  forkable?: ReadonlySet<string>;
  /** Forks the chat after the reply with this id. */
  onFork?: (messageId: string) => void;
  /** "Show in Story state" on a message's marker: the id of the state item to show. */
  onShowLinked?: (itemId: string) => void;
}

export function MessageList({
  sessionId,
  messages,
  characters,
  persona,
  logs,
  story,
  stats,
  undoOnDelete,
  busy,
  runningWorkflow,
  disabled,
  onEdit,
  onDelete,
  lastTurn: last = null,
  onRegenerate,
  onSwipe,
  forkable,
  onFork,
  onShowLinked,
}: MessageListProps) {
  const { viewport, content, onScroll } = useStickToBottom(sessionId, messages);
  // The lines are described once per loaded view; placing the chips is one pass over the messages.
  const turns = useMemo(() => describeTurns(story), [story]);
  const chips = chipsFor(turns, messages);
  // Which messages state items link to: also once per loaded view.
  const links = useMemo(() => messageLinks(story), [story]);
  // Once a reply row is streaming the text itself is the progress indicator.
  const waiting = busy && !messages.some((message) => message.status === 'streaming');
  // A message sent while the previous turn's run after the reply works is queued behind it by the server.
  const queued = useMemo(() => runningPostRun(story) !== undefined, [story]);
  // After a swipe the controls move to another message; focus follows them to the same direction's button.
  const refocus = useRef<-1 | 1>(undefined);
  const swipe = useCallback(
    async (direction: -1 | 1) => {
      if (!last) return;
      const target = last.alternatives[last.activeIndex + direction];
      if (!target) return;
      refocus.current = direction;
      if (!(await onSwipe(target.executionId))) refocus.current = undefined;
    },
    [last, onSwipe],
  );
  const lastReplyId = last?.lastReplyId;
  useLayoutEffect(() => {
    const direction = refocus.current;
    if (direction === undefined || disabled || !lastReplyId) return;
    refocus.current = undefined;
    const buttons = viewport.current?.querySelectorAll<HTMLButtonElement>(
      `[data-message-id="${lastReplyId}"] [data-swipe]`,
    );
    const wanted = [...(buttons ?? [])].find(
      (button) => button.dataset.swipe === String(direction) && !button.disabled,
    );
    (wanted ?? [...(buttons ?? [])].find((button) => !button.disabled))?.focus();
  }, [lastReplyId, disabled, viewport]);
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
            execution={logs[messageLogId(message) ?? '']}
            stats={stats?.[message.id]}
            storyChip={chips.get(message.id)}
            links={links.get(message.id)}
            undoOnDelete={undoOnDelete && (() => undoOnDelete(message.id))}
            alternatives={
              last && message.id === last.lastReplyId
                ? {
                    index: last.activeIndex,
                    count: last.alternatives.length,
                    disabled,
                    swipeDisabled: queued,
                    onRegenerate,
                    onSwipe: (direction) => void swipe(direction),
                  }
                : undefined
            }
            onFork={forkable?.has(message.id) ? onFork : undefined}
            forkDisabled={queued}
            disabled={disabled}
            onEdit={onEdit}
            onDelete={onDelete}
            onShowLinked={onShowLinked}
          />
        ))}
        {waiting && (
          <div className="typing-indicator" role="status" aria-label="Workflow running">
            <span aria-hidden="true" className="typing-dots">
              <i />
              <i />
              <i />
            </span>
            <small>
              {queued ? POST_WAITING_LABEL : runningWorkflow ? `Running ${runningWorkflow}…` : 'Preparing a reply'}
            </small>
          </div>
        )}
      </div>
    </section>
  );
}
