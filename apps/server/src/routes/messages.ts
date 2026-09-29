import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { sendMessage } from '../services/chat.js';
import type { ApiRoute } from './types.js';

export function registerMessages(app: FastifyInstance, context: AppContext) {
  app.post<ApiRoute<'sendMessage'>>('/api/sessions/:id/messages', async (request, reply) => {
    const { id } = apiContract.sendMessage.params.parse(request.params);
    const { content } = apiContract.sendMessage.body.parse(request.body);
    return reply.send(await sendMessage(context, id, content));
  });
}
