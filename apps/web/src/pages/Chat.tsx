import { useCallback, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { activeMessages, alternativesOfLastTurn, replyWorkflows } from '@st/shared';
import { useEscapeArea } from '../keyboard/escapeRegistry.js';
import type { ChatState } from './chat/useChat.js';
import { ChatHeader } from './chat/ChatHeader.js';
import { MessageList } from './chat/MessageList.js';
import { Composer } from './chat/Composer.js';
import { ChatPanel, type Reveal } from './chat/ChatPanel.js';
import { PostRunStatus } from './chat/story/PostRunStatus.js';
import { runningPostRun } from './chat/story/postRuns.js';
import { undoneByDelete } from './chat/story/undoList.js';
import { usePostRunAlerts } from './chat/story/usePostRunAlerts.js';
import { useStoryState } from './chat/story/useStoryState.js';
import { stateDefinitionsStore, useList } from '../stores/index.js';
import './chat/chat.css';

/** The open conversation: header, messages and composer. The shell owns `useChat`, so the session list can share it. */
export function Chat({ chat }: { chat: ChatState }) {
  const session = chat.session;
  const locked = chat.busy || chat.mutating;
  const [panelOpen, setPanelOpen] = useState(false);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  // Escape in the chat: the panel first, then the reply. `busy` is true only while this page's own message is in
  // flight (generating, or waiting for its turn), never during a lone after-reply run, which Escape leaves alone.
  useEscapeArea('chat', () => {
    if (panelOpen) setPanelOpen(false);
    else if (chat.busy) chat.stop();
    else return false;
    return true;
  });
  // A message marker's "Show in Story state": open the panel and let it scroll to the item. Both callbacks keep their
  // identity, so the thread and the panel are not re-rendered by them.
  const [reveal, setReveal] = useState<Reveal>();
  const showLinked = useCallback((itemId: string) => {
    setPanelOpen(true);
    setReveal((current) => ({ itemId, n: (current?.n ?? 0) + 1 }));
  }, []);
  const revealed = useCallback(() => setReveal(undefined), []);
  // One fetch of the chat's story state; it reloads when a turn or a message change finishes, never per token.
  const story = useStoryState(session?.id, !locked);
  // The after-reply run of the latest turn: a quiet status row while it works, one toast if it fails.
  const postRun = useMemo(() => runningPostRun(story.view), [story.view]);
  usePostRunAlerts(session?.id, story.view);
  // What deleting a reply would undo; the shared fold runs only when the trash button is clicked.
  const definitions = useList(stateDefinitionsStore);
  // The chat as it is shown: the replies of alternatives that aren't shown are left out of the thread, the chips
  // and the delete check alike. One pass per change of the messages (a streamed token included), never per child.
  const stored = session?.messages;
  const messages = useMemo(() => (stored ? activeMessages(stored) : undefined), [stored]);
  const view = story.view;
  // The chat's reply list, read only through `replyWorkflows`. It keeps its identity across streamed tokens (the session
  // object changes every token, its list does not), so the memoized panel is not rendered again for them.
  const triggers = session?.triggers;
  const legacyWorkflow = session?.workflowId;
  const replyList = useMemo(
    () => (legacyWorkflow === undefined ? [] : replyWorkflows({ workflowId: legacyWorkflow, triggers })),
    [triggers, legacyWorkflow],
  );
  // The waiting indicator names the running workflow only when there is more than one to tell apart.
  const several = replyList.filter((entry) => entry.enabled).length > 1;
  const undoOnDelete = useMemo(
    () =>
      messages && view ? (messageId: string) => undoneByDelete({ messageId, messages, view, definitions }) : undefined,
    [messages, view, definitions],
  );
  // The controls of the last turn's last reply. None while a run is in flight: the thread is changing under it (a
  // run on an empty send follows the previous turn's replies, which would look like its own).
  const lastTurn = useMemo(() => (stored && !chat.busy ? alternativesOfLastTurn(stored) : null), [stored, chat.busy]);
  return (
    <section className="chat-main">
      {session ? (
        <>
          <ChatHeader
            key={`header-${session.id}`}
            title={session.title}
            characterId={session.characterId}
            personaId={session.personaId}
            characters={chat.characters}
            personas={chat.personas}
            disabled={locked}
            onUpdate={chat.update}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen((open) => !open)}
          />
          <div className="chat-body">
            <div className="chat-conversation">
              <MessageList
                key={`messages-${session.id}`}
                sessionId={session.id}
                messages={messages ?? []}
                characters={chat.characters}
                persona={chat.personas.find((item) => item.id === session.personaId)}
                logs={chat.logs}
                story={story.view}
                undoOnDelete={undoOnDelete}
                busy={chat.busy}
                runningWorkflow={several ? chat.runningWorkflow : undefined}
                disabled={locked}
                onEdit={chat.editMessage}
                onDelete={chat.deleteMessage}
                lastTurn={lastTurn}
                onRegenerate={chat.regenerate}
                onSwipe={chat.swipe}
                onShowLinked={showLinked}
              />
              <PostRunStatus key={`post-${session.id}`} sessionId={session.id} run={postRun} onStopped={story.reload} />
              <Composer
                key={`composer-${session.id}`}
                content={chat.content}
                onChange={chat.setContent}
                busy={chat.busy}
                queued={chat.queued && postRun !== undefined}
                locked={locked}
                onSend={chat.send}
                onStop={chat.stop}
              />
            </div>
            {panelOpen && (
              <ChatPanel
                key={`panel-${session.id}`}
                workflows={chat.workflows}
                replyList={replyList}
                stored={session.settings}
                sessionId={session.id}
                story={story.panel}
                reveal={reveal}
                onRevealed={revealed}
                onSave={chat.updateSettings}
                onSaveReply={chat.updateReplyList}
                onClose={closePanel}
              />
            )}
          </div>
        </>
      ) : (
        <div className="empty-state">
          <h1>Start a conversation</h1>
          <p>Create a chat to run one of your workflows.</p>
          <button
            type="button"
            className="primary chat-new"
            disabled={!chat.workflows.length}
            onClick={() => void chat.create()}
          >
            <Plus size={18} aria-hidden="true" /> New chat
          </button>
        </div>
      )}
    </section>
  );
}
