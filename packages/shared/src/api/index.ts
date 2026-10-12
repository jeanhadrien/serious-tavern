import type { z } from 'zod';
import { sessionEndpoints } from './sessions.js';
import { workflowEndpoints } from './workflows.js';
import { presetEndpoints } from './presets.js';
import { entityEndpoints } from './entities.js';
import { catalogEndpoints } from './catalog.js';
import { importEndpoints } from './imports.js';

export * from './common.js';
export * from './sessions.js';
export * from './workflows.js';
export * from './presets.js';
export * from './entities.js';
export * from './catalog.js';
export * from './imports.js';

export const apiContract = {
  ...sessionEndpoints,
  ...workflowEndpoints,
  ...presetEndpoints,
  ...entityEndpoints,
  ...catalogEndpoints,
  ...importEndpoints,
};
export type ApiEndpoint = keyof typeof apiContract;
export type ApiBody<K extends ApiEndpoint> = z.input<(typeof apiContract)[K]['body']>;
export type ApiParsedBody<K extends ApiEndpoint> = z.output<(typeof apiContract)[K]['body']>;
export type ApiParams<K extends ApiEndpoint> = z.input<(typeof apiContract)[K]['params']>;
export type ApiQuery<K extends ApiEndpoint> = z.input<(typeof apiContract)[K]['query']>;
export type ApiResponse<K extends ApiEndpoint> = z.output<(typeof apiContract)[K]['response']>;
