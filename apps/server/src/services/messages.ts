import type { ApiBody, ApiResponse } from '@st/shared';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';

export async function updateMessage(
  { sessions }: AppContext,
  id: string,
  messageId: string,
  { content }: ApiBody<'updateMessage'>,
): Promise<ApiResponse<'updateMessage'>> {
  const session = await sessions.update(id, (current) => {
    const message = current.messages.find((item) => item.id === messageId);
    if (!message) throw notFound('Message');
    message.content = content;
    return current;
  });
  if (!session) throw notFound('Session');
  return session.messages.find((item) => item.id === messageId)!;
}

export async function deleteMessage({ sessions }: AppContext, id: string, messageId: string): Promise<void> {
  const session = await sessions.update(id, (current) => {
    const index = current.messages.findIndex((item) => item.id === messageId);
    if (index === -1) throw notFound('Message');
    current.messages.splice(index, 1);
    return current;
  });
  if (!session) throw notFound('Session');
}
