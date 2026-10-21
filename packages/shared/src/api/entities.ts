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
  listCharacters: endpoint(z.array(characterSchema)),
  createCharacter: endpoint(characterSchema, characterFieldsSchema),
  getCharacter: endpoint(characterSchema, undefined, idParamsSchema),
  updateCharacter: endpoint(characterSchema, characterUpdateSchema, idParamsSchema),
  deleteCharacter: endpoint(noContentSchema, undefined, idParamsSchema),
  importCharacters: endpoint(characterImportResultSchema, binarySchema),
  getCharacterAvatar: endpoint(binarySchema, undefined, idParamsSchema),
  updateCharacterAvatar: endpoint(characterSchema, binarySchema, idParamsSchema),
  exportCharacter: endpoint(
    z.union([characterCardDataSchema, binarySchema]),
    undefined,
    idParamsSchema,
    characterExportQuerySchema,
  ),
  listPersonas: endpoint(z.array(personaSchema)),
  createPersona: endpoint(personaSchema, personaFieldsSchema),
  getPersona: endpoint(personaSchema, undefined, idParamsSchema),
  updatePersona: endpoint(personaSchema, personaUpdateSchema, idParamsSchema),
  deletePersona: endpoint(noContentSchema, undefined, idParamsSchema),
  importPersonas: endpoint(personaImportResultSchema, binarySchema),
  getPersonaAvatar: endpoint(binarySchema, undefined, idParamsSchema),
  updatePersonaAvatar: endpoint(personaSchema, binarySchema, idParamsSchema),
};
