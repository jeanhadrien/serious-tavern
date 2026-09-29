import type { Character, ChatMessage, ExecutionLog } from '@st/shared';
import { charactersApi } from '../../api.js';
import { ExecutionDetails } from './ExecutionDetails.js';

export function ChatMessageView({
  message,
  character,
  execution,
}: {
  message: ChatMessage;
  character?: Character;
  execution?: ExecutionLog;
}) {
  return (
    <article className={`message ${message.role}`}>
      <small className="message-speaker">
        {message.characterId && typeof character?.avatar === 'string' && (
          <img src={charactersApi.avatarUrl(message.characterId)} alt="" width={28} height={28} />
        )}
        {message.role === 'assistant' ? message.name || message.role : message.role}
      </small>
      <p>{message.content}</p>
      {message.executionId && <ExecutionDetails id={message.executionId} cached={execution} />}
    </article>
  );
}
