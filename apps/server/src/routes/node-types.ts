import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import { descriptors, providers, registry } from '@st/engine';
import type { AppContext } from '../context.js';
import { errorMessage, HttpError, notFound } from '../errors.js';
import type { ApiRoute } from './types.js';

export function registerNodeTypes(app: FastifyInstance, { presets, characters }: AppContext) {
  app.get<ApiRoute<'listNodeTypes'>>('/api/node-types', async () => descriptors());
  app.get<ApiRoute<'listProviders'>>('/api/providers', async () =>
    [...providers.values()].map(({ id, label, secretName }) => ({ id, label, secretName })),
  );
  app.post<ApiRoute<'resolvePorts'>>('/api/node-types/:type/ports', async (request) => {
    const { type } = apiContract.resolvePorts.params.parse(request.params);
    const definition = registry.get(type);
    if (!definition) throw notFound('Node type');
    const { config } = apiContract.resolvePorts.body.parse(request.body);
    try {
      return definition.resolvePorts
        ? await definition.resolvePorts(config, { presets, characters })
        : { inputs: definition.inputs, outputs: definition.outputs };
    } catch (error) {
      throw new HttpError(422, 'PORT_RESOLUTION_FAILED', errorMessage(error));
    }
  });
}
