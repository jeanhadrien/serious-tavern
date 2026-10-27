import type { ApiBody, ApiResponse } from '@st/shared';
import { api, json, type RequestOptions } from './transport.js';

const path = (id: string) => `/snippets/${encodeURIComponent(id)}`;

export const snippetsApi = {
  list: (options?: RequestOptions) => api<ApiResponse<'listSnippets'>>('/snippets', options),
  get: (id: string, options?: RequestOptions) => api<ApiResponse<'getSnippet'>>(path(id), options),
  create: (body: ApiBody<'createSnippet'>, options?: RequestOptions) =>
    api<ApiResponse<'createSnippet'>>('/snippets', { ...json('POST', body), ...options }),
  update: (id: string, body: ApiBody<'updateSnippet'>, options?: RequestOptions) =>
    api<ApiResponse<'updateSnippet'>>(path(id), { ...json('PUT', body), ...options }),
  delete: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'deleteSnippet'>>(path(id), { ...json('DELETE'), ...options }),
};
