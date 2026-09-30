import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { sendMessage } from '../services/chat.js';
import { updateMessage, deleteMessage } from '../services/messages.js';
import type { ApiRoute } from './types.js';

export function registerMessages(app: FastifyInstance, context: AppContext) {
  app.post<ApiRoute<'sendMessage'>>('/api/sessions/:id/messages', async (request, reply) => {
    const { id } = apiContract.sendMessage.params.parse(request.params);
    const { content } = apiContract.sendMessage.body.parse(request.body);
    return reply.send(await sendMessage(context, id, content));
  });
  app.patch<ApiRoute<'updateMessage'>>('/api/sessions/:id/messages/:messageId', async (request) => {
    const { id, messageId } = apiContract.updateMessage.params.parse(request.params);
    const body = apiContract.updateMessage.body.parse(request.body);
    return updateMessage(context, id, messageId, body);
  });
  app.delete<ApiRoute<'deleteMessage'>>('/api/sessions/:id/messages/:messageId', async (request, reply) => {
    const { id, messageId } = apiContract.deleteMessage.params.parse(request.params);
    await deleteMessage(context, id, messageId);
    return reply.code(204).send();
  });
}
