import type { ApiBody, ApiResponse } from '@st/shared';
import { api, json, type RequestOptions } from './transport.js';

const path = (id: string) => `/state-definitions/${encodeURIComponent(id)}`;

export const stateDefinitionsApi = {
  // Whole records (definitions are small), so there is no `get`.
  list: (options?: RequestOptions) => api<ApiResponse<'listStateDefinitions'>>('/state-definitions', options),
  create: (body: ApiBody<'createStateDefinition'>, options?: RequestOptions) =>
    api<ApiResponse<'createStateDefinition'>>('/state-definitions', { ...json('POST', body), ...options }),
  update: (id: string, body: ApiBody<'updateStateDefinition'>, options?: RequestOptions) =>
    api<ApiResponse<'updateStateDefinition'>>(path(id), { ...json('PUT', body), ...options }),
  delete: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'deleteStateDefinition'>>(path(id), { ...json('DELETE'), ...options }),
};
