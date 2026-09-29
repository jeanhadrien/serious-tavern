import type { ApiBody, ApiQuery, ApiResponse } from '@st/shared';
import { api, json, type RequestOptions } from './transport.js';

export const charactersApi = {
  list: (options?: RequestOptions) => api<ApiResponse<'listCharacters'>>('/characters', options),
  get: (id: string, options?: RequestOptions) => api<ApiResponse<'getCharacter'>>(`/characters/${id}`, options),
  create: (body: ApiBody<'createCharacter'>, options?: RequestOptions) =>
    api<ApiResponse<'createCharacter'>>('/characters', { ...json('POST', body), ...options }),
  update: (id: string, body: ApiBody<'updateCharacter'>, options?: RequestOptions) =>
    api<ApiResponse<'updateCharacter'>>(`/characters/${id}`, { ...json('PUT', body), ...options }),
  delete: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'deleteCharacter'>>(`/characters/${id}`, { ...json('DELETE'), ...options }),
  import: (body: FormData, options?: RequestOptions) =>
    api<ApiResponse<'importCharacters'>>('/characters/import', { method: 'POST', body, ...options }),
  uploadAvatar: (id: string, body: FormData, options?: RequestOptions) =>
    api<ApiResponse<'updateCharacterAvatar'>>(`/characters/${id}/avatar`, { method: 'PUT', body, ...options }),
  avatarUrl: (id: string) => `/api/characters/${id}/avatar`,
  exportUrl: (id: string, format: ApiQuery<'exportCharacter'>['format']) =>
    `/api/characters/${id}/export?format=${format}`,
};
export const personasApi = {
  list: (options?: RequestOptions) => api<ApiResponse<'listPersonas'>>('/personas', options),
  get: (id: string, options?: RequestOptions) => api<ApiResponse<'getPersona'>>(`/personas/${id}`, options),
  create: (body: ApiBody<'createPersona'>, options?: RequestOptions) =>
    api<ApiResponse<'createPersona'>>('/personas', { ...json('POST', body), ...options }),
  update: (id: string, body: ApiBody<'updatePersona'>, options?: RequestOptions) =>
    api<ApiResponse<'updatePersona'>>(`/personas/${id}`, { ...json('PUT', body), ...options }),
  delete: (id: string, options?: RequestOptions) =>
    api<ApiResponse<'deletePersona'>>(`/personas/${id}`, { ...json('DELETE'), ...options }),
  import: (body: FormData, options?: RequestOptions) =>
    api<ApiResponse<'importPersonas'>>('/personas/import', { method: 'POST', body, ...options }),
  uploadAvatar: (id: string, body: FormData, options?: RequestOptions) =>
    api<ApiResponse<'updatePersonaAvatar'>>(`/personas/${id}/avatar`, { method: 'PUT', body, ...options }),
  avatarUrl: (id: string) => `/api/personas/${id}/avatar`,
};
