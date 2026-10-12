import type { ApiBody, ApiResponse, ImportApp } from '@st/shared';
import { api, json, type RequestOptions } from './transport.js';

export const importsApi = {
  list: (options?: RequestOptions) => api<ApiResponse<'listImportSources'>>('/import-sources', options),
  set: (app: ImportApp, body: ApiBody<'setImportSource'>, options?: RequestOptions) =>
    api<ApiResponse<'setImportSource'>>(`/import-sources/${app}`, { ...json('PUT', body), ...options }),
  sync: (app: ImportApp, options?: RequestOptions) =>
    api<ApiResponse<'syncImportSource'>>(`/import-sources/${app}/sync`, { ...json('POST'), ...options }),
};
