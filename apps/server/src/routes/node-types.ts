import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import { descriptor, descriptors, registry } from '@st/engine';
import type { AppContext } from '../context.js';
import { errorMessage, HttpError, notFound } from '../errors.js';
import { nodeResources } from '../services/node-resources.js';
import { route } from './route.js';

export function registerNodeTypes(app: FastifyInstance, context: AppContext) {
  route(app, 'listNodeTypes', async () => descriptors());
  route(app, 'getNodeType', async (request) => {
    const { type } = apiContract.getNodeType.params.parse(request.params);
    const found = descriptor(type);
    if (!found) throw notFound('Node type');
    return found;
  });
  route(app, 'resolvePorts', async (request) => {
    const { type } = apiContract.resolvePorts.params.parse(request.params);
    const definition = registry.get(type);
    if (!definition) throw notFound('Node type');
    const { config } = apiContract.resolvePorts.body.parse(request.body);
    try {
      return definition.resolvePorts
        ? await definition.resolvePorts(config, nodeResources(context))
        : { inputs: definition.inputs, outputs: definition.outputs };
    } catch (error) {
      throw new HttpError(422, 'PORT_RESOLUTION_FAILED', errorMessage(error));
    }
  });
}
