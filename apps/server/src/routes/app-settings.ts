import type { FastifyInstance } from 'fastify';
import { apiContract } from '@st/shared';
import type { AppContext } from '../context.js';
import { route } from './route.js';

export function registerAppSettings(app: FastifyInstance, { appSettings, changes }: AppContext) {
  route(app, 'getAppSettings', async () => appSettings.get());
  route(app, 'updateAppSettings', async (request) => {
    const updated = await appSettings.update(apiContract.updateAppSettings.body.parse(request.body));
    // Announced before the response, like every API write.
    changes.publish({ type: 'appSettings.changed' });
    return updated;
  });
}
