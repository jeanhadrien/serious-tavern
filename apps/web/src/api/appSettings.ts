import type { ApiBody, ApiResponse } from '@st/shared';
import { api, json, type RequestOptions } from './transport.js';

export const appSettingsApi = {
  /** The app-wide preferences, defaults filled in. */
  get: (options?: RequestOptions) => api<ApiResponse<'getAppSettings'>>('/app-settings', options),
  /** A partial update; the answer is the whole settings. */
  update: (body: ApiBody<'updateAppSettings'>, options?: RequestOptions) =>
    api<ApiResponse<'updateAppSettings'>>('/app-settings', { ...json('PATCH', body), ...options }),
};
