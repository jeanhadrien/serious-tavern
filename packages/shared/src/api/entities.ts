import { z } from 'zod';
import { characterSchema, personaSchema } from '../character.js';
import { binarySchema, endpoint, idParamsSchema, noContentSchema } from './common.js';

export const characterFieldsSchema = z.object({
  name: characterSchema.shape.name,
  description: characterSchema.shape.description.default(''),
  personality: characterSchema.shape.personality.default(''),
  scenario: characterSchema.shape.scenario.default(''),
  first_mes: characterSchema.shape.first_mes.default(''),
  mes_example: characterSchema.shape.mes_example.default(''),
  creator_notes: characterSchema.shape.creator_notes.default(''),
  system_prompt: characterSchema.shape.system_prompt.default(''),
  post_history_instructions: characterSchema.shape.post_history_instructions.default(''),
  alternate_greetings: characterSchema.shape.alternate_greetings.default([]),
  tags: characterSchema.shape.tags.default([]),
  creator: characterSchema.shape.creator.default(''),
  character_version: characterSchema.shape.character_version.default(''),
  extensions: characterSchema.shape.extensions.default({}),
});
export const personaFieldsSchema = z.object({
  name: personaSchema.shape.name,
  description: personaSchema.shape.description.default(''),
});
// Update bodies are built from the stored schema (no `.default()`), so a field the client left out stays out of
// the parsed body and `updateEntity` keeps the stored value. Defaults belong to the create bodies only.
const serverOwnedFields = { id: true, avatar: true, createdAt: true, updatedAt: true } as const;
export const characterUpdateSchema = z.object(characterSchema.omit(serverOwnedFields).shape).partial();
export const personaUpdateSchema = z.object(personaSchema.omit(serverOwnedFields).shape).partial();
export const importFailureSchema = z.object({
  filename: z.string(),
  error: z.object({ code: z.string(), message: z.string() }),
});
export const characterImportResultSchema = z.object({
  imported: z.array(characterSchema),
  failed: z.array(importFailureSchema),
});
export const personaImportResultSchema = z.object({
  imported: z.array(personaSchema),
  failed: z.array(importFailureSchema),
});
export type EntityImportResult<T> = {
  [K in keyof z.infer<typeof characterImportResultSchema>]: K extends 'imported'
    ? T[]
    : z.infer<typeof characterImportResultSchema>[K];
};
// Card extensions are flattened into the export alongside the known card fields.
export const characterCardDataSchema = characterFieldsSchema.omit({ extensions: true }).catchall(z.unknown());
export const characterExportQuerySchema = z.object({ format: z.enum(['png', 'json']).default('json') });
export const entityEndpoints = {
  listCharacters: endpoint(
    { method: 'GET', path: '/api/characters', description: 'List all characters.' },
    z.array(characterSchema),
  ),
  createCharacter: endpoint(
    { method: 'POST', path: '/api/characters', description: 'Create a character. Fields left out default to empty.' },
    characterSchema,
    characterFieldsSchema,
  ),
  getCharacter: endpoint(
    { method: 'GET', path: '/api/characters/:id', description: 'Get one character card.' },
    characterSchema,
    undefined,
    idParamsSchema,
  ),
  updateCharacter: endpoint(
    {
      method: 'PUT',
      path: '/api/characters/:id',
      description: 'Update a character. Fields left out keep their stored value.',
    },
    characterSchema,
    characterUpdateSchema,
    idParamsSchema,
  ),
  deleteCharacter: endpoint(
    { method: 'DELETE', path: '/api/characters/:id' },
    noContentSchema,
    undefined,
    idParamsSchema,
  ),
  importCharacters: endpoint(
    { method: 'POST', path: '/api/characters/import' },
    characterImportResultSchema,
    binarySchema,
  ),
  getCharacterAvatar: endpoint(
    { method: 'GET', path: '/api/characters/:id/avatar' },
    binarySchema,
    undefined,
    idParamsSchema,
  ),
  updateCharacterAvatar: endpoint(
    { method: 'PUT', path: '/api/characters/:id/avatar' },
    characterSchema,
    binarySchema,
    idParamsSchema,
  ),
  exportCharacter: endpoint(
    { method: 'GET', path: '/api/characters/:id/export' },
    z.union([characterCardDataSchema, binarySchema]),
    undefined,
    idParamsSchema,
    characterExportQuerySchema,
  ),
  listPersonas: endpoint(
    { method: 'GET', path: '/api/personas', description: 'List all personas (who the user plays).' },
    z.array(personaSchema),
  ),
  createPersona: endpoint(
    {
      method: 'POST',
      path: '/api/personas',
      description: 'Create a persona. A missing description defaults to empty.',
    },
    personaSchema,
    personaFieldsSchema,
  ),
  getPersona: endpoint(
    { method: 'GET', path: '/api/personas/:id', description: 'Get one persona.' },
    personaSchema,
    undefined,
    idParamsSchema,
  ),
  updatePersona: endpoint(
    {
      method: 'PUT',
      path: '/api/personas/:id',
      description: 'Update a persona. Fields left out keep their stored value.',
    },
    personaSchema,
    personaUpdateSchema,
    idParamsSchema,
  ),
  deletePersona: endpoint({ method: 'DELETE', path: '/api/personas/:id' }, noContentSchema, undefined, idParamsSchema),
  importPersonas: endpoint({ method: 'POST', path: '/api/personas/import' }, personaImportResultSchema, binarySchema),
  getPersonaAvatar: endpoint(
    { method: 'GET', path: '/api/personas/:id/avatar' },
    binarySchema,
    undefined,
    idParamsSchema,
  ),
  updatePersonaAvatar: endpoint(
    { method: 'PUT', path: '/api/personas/:id/avatar' },
    personaSchema,
    binarySchema,
    idParamsSchema,
  ),
};
