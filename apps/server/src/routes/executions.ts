import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import type { ApiRoute } from './types.js';

export function registerExecutions(app: FastifyInstance, { executions }: AppContext) {
  app.get<ApiRoute<'getExecution'>>('/api/executions/:id', async (request) =>
    requireEntity(executions, apiContract.getExecution.params.parse(request.params).id, 'Execution'),
  );
}
