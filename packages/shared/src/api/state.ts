import { z } from 'zod';
import { linkStatuses } from '../links/status.js';
import { stateDefinitionSchema, stateDefinitionWriteSchema } from '../state/definition.js';
import { historyPointSchema, keyMetaSchema, stateWarningSchema } from '../state/fold-types.js';
import { runStatusSchema, stateWriteSchema, turnRunSchema } from '../state/writes.js';
import { endpoint, idParamsSchema, noContentSchema } from './common.js';

/**
 * `details` of `STATE_DEFINITION_IN_USE`: the chats that hold story state under the definition (renaming
 * and deleting are refused while a present turn wrote it) and, for a delete, the workflows whose State Read,
 * State Write, Next Chunk or Unlinked Messages nodes use it. Either list may be empty.
 */
export const stateDefinitionInUseDetailsSchema = z.object({
  sessions: z.array(z.object({ id: z.string(), title: z.string() })),
  workflows: z.array(z.string()),
});
export type StateDefinitionInUseDetails = z.infer<typeof stateDefinitionInUseDetailsSchema>;

/**
 * The `link` the view adds to an item of a definition's collection key that links to chat messages (items of node keys
 * and items without a link carry none; `values` stays `unknown` per key, this is the shape of that property). Computed
 * from the chat as it is when the view is built, never stored. Positions count the chat's history messages (final or
 * without a status; partial and streaming rows do not count) from 1, user and assistant alike, and only the linked
 * messages that are still in the chat: an item whose messages were all deleted has none of the four position fields.
 */
export const itemLinkViewSchema = z.object({
  status: z.enum(linkStatuses),
  // A broken item (not intact) whose surviving messages intact items of the same key link again: readers skip it and
  // the panel collapses it. Never true for an intact or a `gone` item.
  replaced: z.boolean(),
  // An intact item linking exactly the same messages as an earlier intact one in chat order (an edit that was
  // reverted next to the summary written meanwhile): readers use the earlier one, the panel collapses this one. Computed
  // with the same shared rule as `linked` and State Read's linked mode. Never true for a broken item.
  repeated: z.boolean(),
  // How many messages the item linked when it was written, and how many of those are no longer in the chat.
  count: z.number(),
  missing: z.number(),
  firstIndex: z.number().optional(),
  lastIndex: z.number().optional(),
  // The first and last linked message that is still in the chat (the first is where the panel jumps to).
  firstMessageId: z.string().optional(),
  lastMessageId: z.string().optional(),
  // Every linked message that is still in the chat, in chat order (what the message markers list).
  messageIds: z.array(z.string()),
});
export type ItemLinkView = z.infer<typeof itemLinkViewSchema>;

// A key's folded facts, by key name. `values` has every key of the CURRENT definition (the default when nothing
// valid is stored); `history` has a point per present turn that wrote the key (newest 100, oldest first), with
// the value after that turn for number, boolean and enum keys, the kept item count for collections and only
// the turn for text and object keys.
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
/**
 * A node's collection (Draw's `draws`) has no cap, so the view sends only its newest items: this many.
 * `omitted` says how many were left out, `meta.count` is the total.
 */
export const NODE_ITEMS_LIMIT = 50;
// What a node stored under its own implicit keys (Draw's `draws`): only keys that were written.
export const nodeStateSchema = z.object({
  nodeId: z.string(),
  // The workflow the node belongs to: a node's own state is its workflow's (node ids repeat across workflows). Absent for
  // what was written before chats ran several workflows; those writes are read by the nodes of every workflow.
  workflowId: z.string().optional(),
  // The node's name in its workflow (`Draw #1 (draw)`); absent when the node no longer exists.
  label: z.string().optional(),
  ...keyViews,
  // For each collection key with more than `NODE_ITEMS_LIMIT` items: how many of the oldest items `values`
  // leaves out (so `meta.count` is the length of `values` plus this). Keys that were not cut are absent.
  omitted: z.record(z.string(), z.number()),
});
/** Text in a turn's write summaries is cut to this many characters (see `truncated` on `stateWriteViewSchema`). */
export const WRITE_PREVIEW_LIMIT = 200;
export const stateWriteViewSchema = z.object({
  // The stored write, except that long values are shortened: a text longer than `WRITE_PREVIEW_LIMIT` characters
  // is cut to that length, and an object whose JSON is longer becomes its JSON text, cut the same way.
  write: stateWriteSchema,
  // True when `write` was shortened. The full value is only in the chat's stored `state`.
  truncated: z.boolean().optional(),
  // The current name of the definition a write targets; absent for node keys and deleted definitions.
  definitionName: z.string().optional(),
  // The writing node's name in its workflow (a node-key write names it by its own workflow id; other writes by the
  // first workflow of the chat that has a node with that id); absent when the node no longer exists.
  nodeLabel: z.string().optional(),
});
// One run of a turn, as the chat shows it: the stored record with the restart rule applied (a run stored as `running`
// that the server no longer holds reads as `error`) and the workflow's current name while it exists.
export const turnRunViewSchema = turnRunSchema.extend({ workflowName: z.string().optional() });
export type TurnRunView = z.infer<typeof turnRunViewSchema>;
export const turnStateSchema = z.object({
  executionId: z.string(),
  at: z.string(),
  completed: z.boolean(),
  replies: z.number(),
  // 1-based among the turns that still count; null when its replies were deleted (it no longer counts).
  turnNumber: z.number().nullable(),
  writes: z.array(stateWriteViewSchema),
  // The turn's runs in the order they ran (the workflows of the reply section, then those of the after section).
  runs: z.array(turnRunViewSchema).optional(),
  // How the turn's after section stands, absent when it has none. Derived from the post runs: any running reads as
  // running; else the first error with its text; else stopped if any; else completed. `postExecutionId` is the first
  // post run's and names its execution log; `postError` is cut to a few hundred characters (the log has the full text).
  // A run stored as `running` that the server no longer holds (it restarted) is reported as `error`.
  postStatus: runStatusSchema.optional(),
  postExecutionId: z.string().optional(),
  postError: z.string().optional(),
  // Items the turn's runs asked to store with a link to chat messages and that were dropped at
  // commit time because those messages changed, in plain words (at most a few, each cut); absent when none were. The
  // run's execution log has them too.
  linkWarnings: z.array(z.string()).optional(),
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
