import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { connectors } from '../services/import/connectors.js';
import { setImportSourcePath } from '../services/import/sources.js';
import { syncImportSource } from '../services/import/sync.js';
import type { ApiRoute } from './types.js';

export function registerImports(app: FastifyInstance, context: AppContext) {
  app.get<ApiRoute<'listImportSources'>>('/api/import-sources', async () => context.importSources.list());
  app.put<ApiRoute<'setImportSource'>>('/api/import-sources/:app', async (request) => {
    const { app: appId } = apiContract.setImportSource.params.parse(request.params);
    const { path } = apiContract.setImportSource.body.parse(request.body);
    return setImportSourcePath(context, connectors[appId], path);
  });
  app.post<ApiRoute<'syncImportSource'>>('/api/import-sources/:app/sync', async (request) => {
    const { app: appId } = apiContract.syncImportSource.params.parse(request.params);
    return syncImportSource(context, connectors[appId]);
  });
}
