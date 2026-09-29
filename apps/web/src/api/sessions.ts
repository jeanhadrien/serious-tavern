import type { ApiBody, ApiResponse } from '@st/shared';
import { api, json, type RequestOptions } from './transport.js';

export const sessionsApi = {
  list: (options?: RequestOptions) => api<ApiResponse<'listSessions'>>('/sessions', options),
  get: (id: string, options?: RequestOptions) => api<ApiResponse<'getSession'>>(`/sessions/${id}`, options),
  create: (body: ApiBody<'createSession'>, options?: RequestOptions) =>
    api<ApiResponse<'createSession'>>('/sessions', { ...json('POST', body), ...options }),
  update: (id: string, body: ApiBody<'updateSession'>, options?: RequestOptions) =>
    api<ApiResponse<'updateSession'>>(`/sessions/${id}`, { ...json('PATCH', body), ...options }),
  delete: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'deleteSession'>>(`/sessions/${id}`, { ...json('DELETE'), ...options }),
  sendMessage: (id: string, body: ApiBody<'sendMessage'>, options?: RequestOptions) =>
    api<ApiResponse<'sendMessage'>>(`/sessions/${id}/messages`, { ...json('POST', body), ...options }),
};
export const executionsApi = {
  get: (id: string, options?: RequestOptions) => api<ApiResponse<'getExecution'>>(`/executions/${id}`, options),
};
