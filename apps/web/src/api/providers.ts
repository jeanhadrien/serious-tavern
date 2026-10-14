import type { ApiBody, ApiResponse } from '@st/shared';
import { api, json, type RequestOptions } from './transport.js';

const path = (id: string) => `/providers/${encodeURIComponent(id)}`;

export const providersApi = {
  list: (options?: RequestOptions) => api<ApiResponse<'listProviders'>>('/providers', options),
  create: (body: ApiBody<'createProvider'>, options?: RequestOptions) =>
    api<ApiResponse<'createProvider'>>('/providers', { ...json('POST', body), ...options }),
  update: (id: string, body: ApiBody<'updateProvider'>, options?: RequestOptions) =>
    api<ApiResponse<'updateProvider'>>(path(id), { ...json('PUT', body), ...options }),
  delete: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'deleteProvider'>>(path(id), { ...json('DELETE'), ...options }),
  // `refresh` makes the server fetch the list again instead of answering from its cache.
  models: (id: string, refresh: boolean, options?: RequestOptions) =>
    api<ApiResponse<'listProviderModels'>>(`${path(id)}/models${refresh ? '?refresh=true' : ''}`, options),
  duplicate: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'duplicateProvider'>>(`${path(id)}/duplicate`, { ...json('POST'), ...options }),
};
