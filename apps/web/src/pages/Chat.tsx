import { Plus } from 'lucide-react';
import { useChat } from './chat/useChat.js';
import { ChatSidebar } from './chat/ChatSidebar.js';
import { ChatHeader } from './chat/ChatHeader.js';
import { MessageList } from './chat/MessageList.js';
import { Composer } from './chat/Composer.js';
import './chat/chat.css';

export function Chat() {
  const chat = useChat();
  const session = chat.session;
  const locked = chat.busy || chat.mutating;
  return (
    <div className="chat-layout">
      <ChatSidebar
        sessions={chat.sessions}
        activeId={session?.id}
        canCreate={!!chat.workflows.length}
        disabled={locked}
        onOpen={chat.open}
        onCreate={chat.create}
        onDelete={chat.remove}
      />
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
            />
            <MessageList
              key={`messages-${session.id}`}
              sessionId={session.id}
              messages={session.messages}
              characters={chat.characters}
              persona={chat.personas.find((item) => item.id === session.personaId)}
              logs={chat.logs}
              busy={chat.busy}
              disabled={locked}
              onEdit={chat.editMessage}
              onDelete={chat.deleteMessage}
            />
            <Composer
              key={`composer-${session.id}`}
              content={chat.content}
              onChange={chat.setContent}
              busy={locked}
              onSend={chat.send}
            />
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
    </div>
  );
}
