import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import {
  createProvider,
  deleteProvider,
  duplicateProvider,
  getProvider,
  listProviderModels,
  listProviders,
  updateProvider,
} from '../services/providers.js';
import { route } from './route.js';

export function registerProviders(app: FastifyInstance, context: AppContext) {
  const idOf = (params: unknown) => apiContract.getProvider.params.parse(params).id;
  route(app, 'listProviders', async () => listProviders(context));
  route(app, 'createProvider', async (request, reply) =>
    reply
      .code(201)
      .send(await createProvider(context, apiContract.createProvider.body.parse({ ...(request.body as object) }))),
  );
  route(app, 'getProvider', async (request) => getProvider(context, idOf(request.params)));
  route(app, 'updateProvider', async (request) =>
    updateProvider(
      context,
      idOf(request.params),
      apiContract.updateProvider.body.parse({ ...(request.body as object) }),
    ),
  );
  route(app, 'deleteProvider', async (request, reply) => {
    await deleteProvider(context, idOf(request.params));
    return reply.code(204).send();
  });
  route(app, 'listProviderModels', async (request) =>
    listProviderModels(
      context,
      idOf(request.params),
      apiContract.listProviderModels.query.parse(request.query).refresh === 'true',
    ),
  );
  route(app, 'duplicateProvider', async (request, reply) =>
    reply.code(201).send(await duplicateProvider(context, idOf(request.params))),
  );
}
