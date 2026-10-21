import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import {
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  updateCollection,
} from '../services/collections.js';
import { route } from './route.js';

export function registerCollections(app: FastifyInstance, context: AppContext) {
  const idOf = (params: unknown) => apiContract.getCollection.params.parse(params).id;
  route(app, 'listCollections', async () => listCollections(context));
  route(app, 'createCollection', async (request, reply) =>
    reply
      .code(201)
      .send(await createCollection(context, apiContract.createCollection.body.parse({ ...(request.body as object) }))),
  );
  route(app, 'getCollection', async (request) => getCollection(context, idOf(request.params)));
  route(app, 'updateCollection', async (request) =>
    updateCollection(
      context,
      idOf(request.params),
      apiContract.updateCollection.body.parse({ ...(request.body as object) }),
    ),
  );
  route(app, 'deleteCollection', async (request, reply) => {
    await deleteCollection(context, idOf(request.params));
    return reply.code(204).send();
  });
}
