import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import type { ApiRoute } from './types.js';

export function registerSecrets(app: FastifyInstance, { secrets }: AppContext) {
  app.get<ApiRoute<'listSecrets'>>('/api/secrets', async () => secrets.list());
  app.put<ApiRoute<'setSecret'>>('/api/secrets/:name', async (request, reply) => {
    const { name } = apiContract.setSecret.params.parse(request.params);
    const { value } = apiContract.setSecret.body.parse(request.body);
    await secrets.set(name, value);
    return reply.code(204).send();
  });
  app.delete<ApiRoute<'deleteSecret'>>('/api/secrets/:name', async (request, reply) => {
    await secrets.delete(apiContract.deleteSecret.params.parse(request.params).name);
    return reply.code(204).send();
  });
}
