import { z } from 'zod';
import { stateDefinitionSchema, stateDefinitionWriteSchema } from '../state/definition.js';
import { endpoint, idParamsSchema, noContentSchema } from './common.js';

/**
 * `details` of `STATE_DEFINITION_IN_USE`: the chats that hold story state under the definition (renaming
 * and deleting are refused while a present turn wrote it) and, for a delete, the workflows whose State Read
 * or State Write nodes use it. Either list may be empty.
 */
export const stateDefinitionInUseDetailsSchema = z.object({
  sessions: z.array(z.object({ id: z.string(), title: z.string() })),
  workflows: z.array(z.string()),
});
export type StateDefinitionInUseDetails = z.infer<typeof stateDefinitionInUseDetailsSchema>;

export const stateEndpoints = {
  // Definitions in file-name order; clients sort.
  listStateDefinitions: endpoint(z.array(stateDefinitionSchema)),
  getStateDefinition: endpoint(stateDefinitionSchema, undefined, idParamsSchema),
  // 409 `STATE_DEFINITION_NAME_TAKEN` when another definition has the name (compared ignoring case).
  createStateDefinition: endpoint(stateDefinitionSchema, stateDefinitionWriteSchema),
  // Replaces name, description and keys; unknown top-level fields of the stored record survive. Changing keys or
  // types is always allowed (stored data is never rewritten). 409 `STATE_DEFINITION_NAME_TAKEN`, and
  // 409 `STATE_DEFINITION_IN_USE` for a rename while a chat holds story state under the old name.
  updateStateDefinition: endpoint(stateDefinitionSchema, stateDefinitionWriteSchema, idParamsSchema),
  // 409 `STATE_DEFINITION_IN_USE` while a chat holds story state for it or a workflow node uses it.
  deleteStateDefinition: endpoint(noContentSchema, undefined, idParamsSchema),
};
