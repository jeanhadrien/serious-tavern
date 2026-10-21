import type { z } from 'zod';
import { sessionEndpoints } from './sessions.js';
import { workflowEndpoints } from './workflows.js';
import { presetEndpoints } from './presets.js';
import { providerEndpoints } from './providers.js';
import { collectionEndpoints } from './collections.js';
import { stateEndpoints } from './state.js';
import { entityEndpoints } from './entities.js';
import { catalogEndpoints } from './catalog.js';
import { importEndpoints } from './imports.js';
import { eventEndpoints } from './events.js';
import { appSettingsEndpoints } from './app-settings.js';
import { messageStatsEndpoints } from './message-stats.js';

export * from './common.js';
export * from './sessions.js';
export * from './workflows.js';
export * from './presets.js';
export * from './providers.js';
export * from './collections.js';
export * from './state.js';
export * from './entities.js';
export * from './catalog.js';
export * from './imports.js';
export * from './events.js';
export * from './app-settings.js';
export * from './message-stats.js';

export const apiContract = {
  ...sessionEndpoints,
  ...workflowEndpoints,
  ...presetEndpoints,
  ...providerEndpoints,
  ...collectionEndpoints,
  ...stateEndpoints,
  ...entityEndpoints,
  ...catalogEndpoints,
  ...importEndpoints,
  ...eventEndpoints,
  ...appSettingsEndpoints,
  ...messageStatsEndpoints,
};
export type ApiEndpoint = keyof typeof apiContract;
export type ApiBody<K extends ApiEndpoint> = z.input<(typeof apiContract)[K]['body']>;
export type ApiParsedBody<K extends ApiEndpoint> = z.output<(typeof apiContract)[K]['body']>;
export type ApiParams<K extends ApiEndpoint> = z.input<(typeof apiContract)[K]['params']>;
export type ApiQuery<K extends ApiEndpoint> = z.input<(typeof apiContract)[K]['query']>;
export type ApiResponse<K extends ApiEndpoint> = z.output<(typeof apiContract)[K]['response']>;
