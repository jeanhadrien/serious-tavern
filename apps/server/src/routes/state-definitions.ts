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
import { route } from './route.js';

export function registerStateDefinitions(app: FastifyInstance, context: AppContext) {
  const idOf = (params: unknown) => apiContract.getStateDefinition.params.parse(params).id;
  route(app, 'listStateDefinitions', async () => listStateDefinitions(context));
  route(app, 'createStateDefinition', async (request, reply) =>
    reply
      .code(201)
      .send(
        await createStateDefinition(
          context,
          apiContract.createStateDefinition.body.parse({ ...(request.body as object) }),
        ),
      ),
  );
  route(app, 'getStateDefinition', async (request) => getStateDefinition(context, idOf(request.params)));
  route(app, 'updateStateDefinition', async (request) =>
    updateStateDefinition(
      context,
      idOf(request.params),
      apiContract.updateStateDefinition.body.parse({ ...(request.body as object) }),
    ),
  );
  route(app, 'deleteStateDefinition', async (request, reply) => {
    await deleteStateDefinition(context, idOf(request.params));
    return reply.code(204).send();
  });
}
