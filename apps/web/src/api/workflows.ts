import type { ApiBody, ApiResponse } from '@st/shared';
import { api, json, type RequestOptions } from './transport.js';

export const workflowsApi = {
  list: (options?: RequestOptions) => api<ApiResponse<'listWorkflows'>>('/workflows', options),
  get: (id: string, options?: RequestOptions) => api<ApiResponse<'getWorkflow'>>(`/workflows/${id}`, options),
  create: (body: ApiBody<'createWorkflow'>, options?: RequestOptions) =>
    api<ApiResponse<'createWorkflow'>>('/workflows', { ...json('POST', body), ...options }),
  update: (id: string, body: ApiBody<'updateWorkflow'>, options?: RequestOptions) =>
    api<ApiResponse<'updateWorkflow'>>(`/workflows/${id}`, { ...json('PUT', body), ...options }),
  delete: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'deleteWorkflow'>>(`/workflows/${id}`, { ...json('DELETE'), ...options }),
  validateDraft: (body: ApiBody<'validateWorkflowDraft'>, options?: RequestOptions) =>
    api<ApiResponse<'validateWorkflowDraft'>>('/workflows/validate', { ...json('POST', body), ...options }),
  validate: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'validateWorkflow'>>(`/workflows/${id}/validate`, { ...json('POST'), ...options }),
};
