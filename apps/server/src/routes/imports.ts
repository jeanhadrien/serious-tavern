import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { connectors } from '../services/import/connectors.js';
import { setImportSourcePath } from '../services/import/sources.js';
import { syncImportSource } from '../services/import/sync.js';
import { route } from './route.js';

export function registerImports(app: FastifyInstance, context: AppContext) {
  route(app, 'listImportSources', async () => context.importSources.list());
  route(app, 'setImportSource', async (request) => {
    const { app: appId } = apiContract.setImportSource.params.parse(request.params);
    const { path } = apiContract.setImportSource.body.parse(request.body);
    return setImportSourcePath(context, connectors[appId], path);
  });
  route(app, 'syncImportSource', async (request) => {
    const { app: appId } = apiContract.syncImportSource.params.parse(request.params);
    return syncImportSource(context, connectors[appId]);
  });
}
