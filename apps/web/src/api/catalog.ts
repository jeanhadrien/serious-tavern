import type { ApiBody, ApiResponse } from '@st/shared';
import { api, json, type RequestOptions } from './transport.js';

export const nodeTypesApi = {
  list: (options?: RequestOptions) => api<ApiResponse<'listNodeTypes'>>('/node-types', options),
  resolvePorts: (type: string, config: ApiBody<'resolvePorts'>['config'], options?: RequestOptions) =>
    api<ApiResponse<'resolvePorts'>>(`/node-types/${type}/ports`, { ...json('POST', { config }), ...options }),
};
export const providersApi = {
  list: (options?: RequestOptions) => api<ApiResponse<'listProviders'>>('/providers', options),
};
export const secretsApi = {
  list: (options?: RequestOptions) => api<ApiResponse<'listSecrets'>>('/secrets', options),
  set: (name: string, body: ApiBody<'setSecret'>, options?: RequestOptions) =>
    api<ApiResponse<'setSecret'>>(`/secrets/${encodeURIComponent(name)}`, { ...json('PUT', body), ...options }),
  delete: (name: string, options?: RequestOptions) =>
    api<ApiResponse<'deleteSecret'>>(`/secrets/${encodeURIComponent(name)}`, { ...json('DELETE'), ...options }),
};
