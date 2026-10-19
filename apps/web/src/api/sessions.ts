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
  updateMessage: (id: string, messageId: string, body: ApiBody<'updateMessage'>, options?: RequestOptions) =>
    api<ApiResponse<'updateMessage'>>(`/sessions/${id}/messages/${messageId}`, { ...json('PATCH', body), ...options }),
  deleteMessage: (id: string, messageId: string, options?: RequestOptions) =>
    api<ApiResponse<'deleteMessage'>>(`/sessions/${id}/messages/${messageId}`, { ...json('DELETE'), ...options }),
  /** Shows another alternative of the last turn; the answer is the whole stored session. */
  setAlternative: (id: string, body: ApiBody<'setAlternative'>, options?: RequestOptions) =>
    api<ApiResponse<'setAlternative'>>(`/sessions/${id}/alternative`, { ...json('PATCH', body), ...options }),
  /** What each enabled workflow of the chat's reply list waits for: which run together (read-only). */
  replyPlan: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'getReplyPlan'>>(`/sessions/${id}/reply-plan`, options),
  /** The chat's computed story state (read-only; the fold the next turn starts from). */
  state: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'getSessionState'>>(`/sessions/${id}/state`, options),
  stopTurn: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'stopTurn'>>(`/sessions/${id}/stop`, { ...json('POST'), ...options }),
};

export const executionsApi = {
  get: (id: string, options?: RequestOptions) => api<ApiResponse<'getExecution'>>(`/executions/${id}`, options),
};
