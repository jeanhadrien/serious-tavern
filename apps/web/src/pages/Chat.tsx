import { useCallback, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ChatState } from './chat/useChat.js';
import { ChatHeader } from './chat/ChatHeader.js';
import { MessageList } from './chat/MessageList.js';
import { Composer } from './chat/Composer.js';
import { ChatPanel } from './chat/ChatPanel.js';
import { useStoryState } from './chat/story/useStoryState.js';
import './chat/chat.css';

/** The open conversation: header, messages and composer. The shell owns `useChat`, so the session list can share it. */
export function Chat({ chat }: { chat: ChatState }) {
  const session = chat.session;
  const locked = chat.busy || chat.mutating;
  const [panelOpen, setPanelOpen] = useState(false);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  // One fetch of the chat's story state; it reloads when a turn or a message change finishes, never per token.
  const story = useStoryState(session?.id, !locked);
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
                busy={chat.busy}
                disabled={locked}
                onEdit={chat.editMessage}
                onDelete={chat.deleteMessage}
              />
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
