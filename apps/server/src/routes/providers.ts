import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import {
  createProvider,
  deleteProvider,
  duplicateProvider,
  getProvider,
  listProviders,
  updateProvider,
} from '../services/providers.js';
import type { ApiRoute } from './types.js';

export function registerProviders(app: FastifyInstance, context: AppContext) {
  const idOf = (params: unknown) => apiContract.getProvider.params.parse(params).id;
  app.get<ApiRoute<'listProviders'>>('/api/providers', async () => listProviders(context));
  app.post<ApiRoute<'createProvider'>>('/api/providers', async (request, reply) =>
    reply
      .code(201)
      .send(await createProvider(context, apiContract.createProvider.body.parse({ ...(request.body as object) }))),
  );
  app.get<ApiRoute<'getProvider'>>('/api/providers/:id', async (request) => getProvider(context, idOf(request.params)));
  app.put<ApiRoute<'updateProvider'>>('/api/providers/:id', async (request) =>
    updateProvider(
      context,
      idOf(request.params),
      apiContract.updateProvider.body.parse({ ...(request.body as object) }),
    ),
  );
  app.delete<ApiRoute<'deleteProvider'>>('/api/providers/:id', async (request, reply) => {
    await deleteProvider(context, idOf(request.params));
    return reply.code(204).send();
  });
  app.post<ApiRoute<'duplicateProvider'>>('/api/providers/:id/duplicate', async (request, reply) =>
    reply.code(201).send(await duplicateProvider(context, idOf(request.params))),
  );
}
