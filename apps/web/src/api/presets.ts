import type { ApiBody, ApiResponse } from '@st/shared';
import { api, json, type RequestOptions } from './transport.js';

export const presetsApi = {
  list: (options?: RequestOptions) => api<ApiResponse<'listPresets'>>('/presets', options),
  get: (id: string, options?: RequestOptions) => api<ApiResponse<'getPreset'>>(`/presets/${id}`, options),
  create: (body: ApiBody<'createPreset'>, options?: RequestOptions) =>
    api<ApiResponse<'createPreset'>>('/presets', { ...json('POST', body), ...options }),
  update: (id: string, body: ApiBody<'updatePreset'>, options?: RequestOptions) =>
    api<ApiResponse<'updatePreset'>>(`/presets/${id}`, { ...json('PUT', body), ...options }),
  delete: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'deletePreset'>>(`/presets/${id}`, { ...json('DELETE'), ...options }),
  preview: (body: ApiBody<'previewPreset'>, options?: RequestOptions) =>
    api<ApiResponse<'previewPreset'>>('/presets/preview', { ...json('POST', body), ...options }),
};
