import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { createSnippet, deleteSnippet, getSnippet, updateSnippet } from '../services/snippets.js';
import { route } from './route.js';

export function registerSnippets(app: FastifyInstance, context: AppContext) {
  const idOf = (params: unknown) => apiContract.getSnippet.params.parse(params).id;
  route(app, 'listSnippets', async () => context.snippets.list());
  route(app, 'createSnippet', async (request, reply) =>
    reply
      .code(201)
      .send(await createSnippet(context, apiContract.createSnippet.body.parse({ ...(request.body as object) }))),
  );
  route(app, 'getSnippet', async (request) => getSnippet(context, idOf(request.params)));
  route(app, 'updateSnippet', async (request) =>
    updateSnippet(context, idOf(request.params), apiContract.updateSnippet.body.parse({ ...(request.body as object) })),
  );
  route(app, 'deleteSnippet', async (request, reply) => {
    await deleteSnippet(context, idOf(request.params));
    return reply.code(204).send();
  });
}
