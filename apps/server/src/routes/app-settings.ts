import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import type { ApiRoute } from './types.js';

export function registerAppSettings(app: FastifyInstance, { appSettings, changes }: AppContext) {
  app.get<ApiRoute<'getAppSettings'>>('/api/app-settings', async () => appSettings.get());
  app.patch<ApiRoute<'updateAppSettings'>>('/api/app-settings', async (request) => {
    const updated = await appSettings.update(apiContract.updateAppSettings.body.parse(request.body));
    // Announced before the response, like every API write.
    changes.publish({ type: 'appSettings.changed' });
    return updated;
  });
}
