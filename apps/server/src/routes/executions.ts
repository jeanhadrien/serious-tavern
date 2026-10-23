import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { route } from './route.js';

export function registerExecutions(app: FastifyInstance, { executions }: AppContext) {
  route(app, 'getExecution', async (request) =>
    requireEntity(executions, apiContract.getExecution.params.parse(request.params).id, 'Execution'),
  );
}
