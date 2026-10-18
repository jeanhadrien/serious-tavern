import { useCallback, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ChatState } from './chat/useChat.js';
import { ChatHeader } from './chat/ChatHeader.js';
import { MessageList } from './chat/MessageList.js';
import { Composer } from './chat/Composer.js';
import { ChatPanel } from './chat/ChatPanel.js';
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
  // One fetch of the chat's story state; it reloads when a turn or a message change finishes, never per token.
  const story = useStoryState(session?.id, !locked);
  // The after-reply run of the latest turn: a quiet status row while it works, one toast if it fails.
  const postRun = useMemo(() => runningPostRun(story.view), [story.view]);
  usePostRunAlerts(session?.id, story.view);
  // What deleting a reply would undo; the shared fold runs only when the trash button is clicked.
  const definitions = useList(stateDefinitionsStore);
  const messages = session?.messages;
  const view = story.view;
  const undoOnDelete = useMemo(
    () =>
      messages && view ? (messageId: string) => undoneByDelete({ messageId, messages, view, definitions }) : undefined,
    [messages, view, definitions],
  );
  return (
    <section className="chat-main">
      {session ? (
        <>
          <ChatHeader
            key={`header-${session.id}`}
            title={session.title}
            workflowId={session.workflowId}
            characterId={session.characterId}
            personaId={session.personaId}
            workflows={chat.workflows}
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
                messages={session.messages}
                characters={chat.characters}
                persona={chat.personas.find((item) => item.id === session.personaId)}
                logs={chat.logs}
                story={story.view}
                undoOnDelete={undoOnDelete}
                busy={chat.busy}
                disabled={locked}
                onEdit={chat.editMessage}
                onDelete={chat.deleteMessage}
              />
              <PostRunStatus key={`post-${session.id}`} sessionId={session.id} run={postRun} />
              <Composer
                key={`composer-${session.id}`}
                content={chat.content}
                onChange={chat.setContent}
                busy={chat.busy}
                locked={locked}
                onSend={chat.send}
                onStop={chat.stop}
              />
            </div>
            {panelOpen && (
              <ChatPanel
                key={`panel-${session.id}`}
                workflow={chat.workflows.find((item) => item.id === session.workflowId)}
                stored={session.settings}
                sessionId={session.id}
                story={story.panel}
                onSave={chat.updateSettings}
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
