import { expectTypeOf, it } from 'vitest';
import type { ApiBody, ApiResponse } from '@st/shared';
import {
  sessionsApi,
  workflowsApi,
  presetsApi,
  charactersApi,
  personasApi,
  secretsApi,
  importsApi,
  collectionsApi,
} from '../api.js';

it('infers client requests and responses directly from shared schemas', () => {
  expectTypeOf(sessionsApi.sendMessage).parameter(1).toEqualTypeOf<ApiBody<'sendMessage'>>();
  expectTypeOf(sessionsApi.sendMessage).returns.toEqualTypeOf<Promise<ApiResponse<'sendMessage'>>>();
  expectTypeOf(sessionsApi.update).parameter(1).toEqualTypeOf<ApiBody<'updateSession'>>();
  expectTypeOf(workflowsApi.update).parameter(1).toEqualTypeOf<ApiBody<'updateWorkflow'>>();
  expectTypeOf(presetsApi.preview).parameter(0).toEqualTypeOf<ApiBody<'previewPreset'>>();
  expectTypeOf(charactersApi.create).parameter(0).toEqualTypeOf<ApiBody<'createCharacter'>>();
  expectTypeOf(personasApi.update).parameter(1).toEqualTypeOf<ApiBody<'updatePersona'>>();
  expectTypeOf(secretsApi.list).returns.toEqualTypeOf<Promise<ApiResponse<'listSecrets'>>>();
  expectTypeOf(importsApi.set).parameter(1).toEqualTypeOf<ApiBody<'setImportSource'>>();
  expectTypeOf(importsApi.sync).returns.toEqualTypeOf<Promise<ApiResponse<'syncImportSource'>>>();
  expectTypeOf(collectionsApi.update).parameter(1).toEqualTypeOf<ApiBody<'updateCollection'>>();
  expectTypeOf(collectionsApi.list).returns.toEqualTypeOf<Promise<ApiResponse<'listCollections'>>>();
});
