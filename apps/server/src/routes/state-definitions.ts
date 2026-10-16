import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import {
  createStateDefinition,
  deleteStateDefinition,
  getStateDefinition,
  listStateDefinitions,
  updateStateDefinition,
} from '../services/state-definitions.js';
import type { ApiRoute } from './types.js';

export function registerStateDefinitions(app: FastifyInstance, context: AppContext) {
  const idOf = (params: unknown) => apiContract.getStateDefinition.params.parse(params).id;
  app.get<ApiRoute<'listStateDefinitions'>>('/api/state-definitions', async () => listStateDefinitions(context));
  app.post<ApiRoute<'createStateDefinition'>>('/api/state-definitions', async (request, reply) =>
    reply
      .code(201)
      .send(
        await createStateDefinition(
          context,
          apiContract.createStateDefinition.body.parse({ ...(request.body as object) }),
        ),
      ),
  );
  app.get<ApiRoute<'getStateDefinition'>>('/api/state-definitions/:id', async (request) =>
    getStateDefinition(context, idOf(request.params)),
  );
  app.put<ApiRoute<'updateStateDefinition'>>('/api/state-definitions/:id', async (request) =>
    updateStateDefinition(
      context,
      idOf(request.params),
      apiContract.updateStateDefinition.body.parse({ ...(request.body as object) }),
    ),
  );
  app.delete<ApiRoute<'deleteStateDefinition'>>('/api/state-definitions/:id', async (request, reply) => {
    await deleteStateDefinition(context, idOf(request.params));
    return reply.code(204).send();
  });
}
