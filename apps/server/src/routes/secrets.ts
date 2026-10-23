import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { route } from './route.js';

export function registerSecrets(app: FastifyInstance, { secrets }: AppContext) {
  route(app, 'listSecrets', async () => secrets.list());
  route(app, 'setSecret', async (request, reply) => {
    const { name } = apiContract.setSecret.params.parse(request.params);
    const { value } = apiContract.setSecret.body.parse(request.body);
    await secrets.set(name, value);
    return reply.code(204).send();
  });
  route(app, 'deleteSecret', async (request, reply) => {
    await secrets.delete(apiContract.deleteSecret.params.parse(request.params).name);
    return reply.code(204).send();
  });
}
