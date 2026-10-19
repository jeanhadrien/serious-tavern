import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import type { ApiRoute } from './types.js';

export function registerAppSettings(app: FastifyInstance, { appSettings }: AppContext) {
  app.get<ApiRoute<'getAppSettings'>>('/api/app-settings', async () => appSettings.get());
  app.patch<ApiRoute<'updateAppSettings'>>('/api/app-settings', async (request) =>
    appSettings.update(apiContract.updateAppSettings.body.parse(request.body)),
  );
}
