import { z } from 'zod';
import { stateDefinitionSchema, stateDefinitionWriteSchema } from '../state/definition.js';
import { historyPointSchema, keyMetaSchema, stateWarningSchema } from '../state/fold-types.js';
import { stateWriteSchema } from '../state/writes.js';
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

// A key's folded facts, by key name. `values` has every key of the CURRENT definition (the default when nothing
// valid is stored); `history` has a point per present turn that wrote the key (newest 100, oldest first).
const keyViews = {
  values: z.record(z.string(), z.unknown()),
  meta: z.record(z.string(), keyMetaSchema),
  history: z.record(z.string(), z.array(historyPointSchema)),
};
export const definitionStateSchema = z.object({
  definitionId: z.string(),
  name: z.string(),
  ...keyViews,
  // Stored values that don't fit the current definition (read as the default; the data is never touched).
  warnings: z.array(stateWarningSchema),
});
// What a node stored under its own implicit keys (Draw's `draws`): only keys that were written.
export const nodeStateSchema = z.object({
  nodeId: z.string(),
  // The node's name in the chat's workflow (`Draw #1 (draw)`); absent when the node no longer exists.
  label: z.string().optional(),
  ...keyViews,
});
export const stateWriteViewSchema = z.object({
  write: stateWriteSchema,
  // The current name of the definition a write targets; absent for node keys and deleted definitions.
  definitionName: z.string().optional(),
  // The writing node's name in the chat's workflow; absent when the node no longer exists.
  nodeLabel: z.string().optional(),
});
export const turnStateSchema = z.object({
  executionId: z.string(),
  at: z.string(),
  completed: z.boolean(),
  replies: z.number(),
  // 1-based among the turns that still count; null when its replies were deleted (it no longer counts).
  turnNumber: z.number().nullable(),
  writes: z.array(stateWriteViewSchema),
});
export const sessionStateViewSchema = z.object({
  // The turn the next message will be.
  turn: z.number(),
  // Every state definition, oldest first (keys nobody wrote are at their defaults, `meta.written` false).
  definitions: z.array(definitionStateSchema),
  nodes: z.array(nodeStateSchema),
  // Every stored turn entry in order, including those that no longer count.
  turns: z.array(turnStateSchema),
});
export type SessionStateView = z.infer<typeof sessionStateViewSchema>;

export const stateEndpoints = {
  // The chat's computed story state: what its next turn would start from. Read-only (the fold of its stored
  // turns against the current definitions).
  getSessionState: endpoint(sessionStateViewSchema, undefined, idParamsSchema),
  // Definitions in file-name order; clients sort.
  listStateDefinitions: endpoint(z.array(stateDefinitionSchema)),
  getStateDefinition: endpoint(stateDefinitionSchema, undefined, idParamsSchema),
  // 409 `STATE_DEFINITION_NAME_TAKEN` when another definition has the name (compared ignoring case).
  createStateDefinition: endpoint(stateDefinitionSchema, stateDefinitionWriteSchema),
  // Replaces name, description and keys; unknown top-level fields of the stored record survive. Changing keys or
  // types is always allowed (stored data is never rewritten); workflows using the definition lose their
  // connections to ports that no longer exist, and a State node whose key or operation no longer fits is
  // reported by validation until it is reconfigured. 409 `STATE_DEFINITION_NAME_TAKEN`, and
  // 409 `STATE_DEFINITION_IN_USE` for a rename while a chat holds story state under the old name.
  updateStateDefinition: endpoint(stateDefinitionSchema, stateDefinitionWriteSchema, idParamsSchema),
  // 409 `STATE_DEFINITION_IN_USE` while a chat holds story state for it or a workflow node uses it.
  deleteStateDefinition: endpoint(noContentSchema, undefined, idParamsSchema),
};
