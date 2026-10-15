import type { ApiBody, ApiResponse } from '@st/shared';
import { api, json, type RequestOptions } from './transport.js';

const path = (id: string) => `/collections/${encodeURIComponent(id)}`;

export const collectionsApi = {
  // Summaries only (entries are counted); `get` reads a whole collection.
  list: (options?: RequestOptions) => api<ApiResponse<'listCollections'>>('/collections', options),
  get: (id: string, options?: RequestOptions) => api<ApiResponse<'getCollection'>>(path(id), options),
  create: (body: ApiBody<'createCollection'>, options?: RequestOptions) =>
    api<ApiResponse<'createCollection'>>('/collections', { ...json('POST', body), ...options }),
  update: (id: string, body: ApiBody<'updateCollection'>, options?: RequestOptions) =>
    api<ApiResponse<'updateCollection'>>(path(id), { ...json('PUT', body), ...options }),
  delete: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'deleteCollection'>>(path(id), { ...json('DELETE'), ...options }),
};
