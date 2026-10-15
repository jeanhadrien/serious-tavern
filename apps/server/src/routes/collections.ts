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
import type { ApiRoute } from './types.js';

export function registerCollections(app: FastifyInstance, context: AppContext) {
  const idOf = (params: unknown) => apiContract.getCollection.params.parse(params).id;
  app.get<ApiRoute<'listCollections'>>('/api/collections', async () => listCollections(context));
  app.post<ApiRoute<'createCollection'>>('/api/collections', async (request, reply) =>
    reply
      .code(201)
      .send(await createCollection(context, apiContract.createCollection.body.parse({ ...(request.body as object) }))),
  );
  app.get<ApiRoute<'getCollection'>>('/api/collections/:id', async (request) =>
    getCollection(context, idOf(request.params)),
  );
  app.put<ApiRoute<'updateCollection'>>('/api/collections/:id', async (request) =>
    updateCollection(
      context,
      idOf(request.params),
      apiContract.updateCollection.body.parse({ ...(request.body as object) }),
    ),
  );
  app.delete<ApiRoute<'deleteCollection'>>('/api/collections/:id', async (request, reply) => {
    await deleteCollection(context, idOf(request.params));
    return reply.code(204).send();
  });
}
