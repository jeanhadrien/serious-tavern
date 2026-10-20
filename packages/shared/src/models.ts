import { z } from 'zod';
import { portDataTypes } from './ports.js';
import { workflowSettingSchema } from './chat-settings.js';
import { sessionStateSchema } from './state/writes.js';
import { sessionTriggersSchema } from './triggers.js';
export const validationIssueSchema = z.object({
  message: z.string(),
  edgeId: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
});
// Stored records preserve unknown fields (passthrough) so forward-compatible reads
// never drop data added by newer versions; writes migrate-on-write via these schemas.
export const nodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    position: z.object({ x: z.number(), y: z.number() }),
  })
  .passthrough();
export const edgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    sourceHandle: z.string().min(1),
    target: z.string().min(1),
    targetHandle: z.string().min(1),
  })
  .passthrough();
export const workflowSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    nodes: z.array(nodeSchema),
    edges: z.array(edgeSchema),
    // Chat settings the workflow declares. Absent in older files (and stored records are not parsed on
    // read), so read them through `workflowSettings()`, never as `workflow.settings` directly.
    settings: z.array(workflowSettingSchema).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
export const messageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    createdAt: z.string(),
    // The turn: the execution id of its first run (and of the turn's entry). Every message of the turn carries it.
    executionId: z.string().optional(),
    // An assistant message only: the execution log of the run that wrote it (a turn has one run per listed workflow).
    // Absent in older messages, whose log is the `executionId` one: read it as `runId ?? executionId`.
    runId: z.string().optional(),
    name: z.string().optional(),
    characterId: z.string().optional(),
    // `streaming` while a turn runs; `partial` when stopped early; `final` once complete.
    status: z.enum(['final', 'streaming', 'partial']).optional(),
    // Stored for display only; reasoning never enters prompt content.
    reasoning: z.string().optional(),
    nodeId: z.string().optional(),
    // Set when the content was edited after it was stored (display only: stored state is never recomputed).
    editedAt: z.string().optional(),
    // Regenerate and swipes (alternatives.ts): on the replies of a regenerated alternative, the `executionId` of the
    // first alternative of that turn (the root, whose own replies don't carry it). Absent in older messages.
    alternativeOf: z.string().optional(),
    // Written only as `true`, on the replies of an alternative that isn't shown. Absent means active, so every
    // stored message is active. Read it as `inactive === true` (see `activeMessages`).
    inactive: z.boolean().optional(),
  })
  .passthrough();
export const sessionSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    // Mirrors the first entry of the reply list (every write of the list writes it too), so older readers keep
    // working. New code reads the list through `replyWorkflows`, never this, to decide what runs.
    workflowId: z.string(),
    // The workflows a reply runs, in order (see triggers.ts). Absent in older files, and stored records are not
    // parsed on read: read it through `replyWorkflows`.
    triggers: sessionTriggersSchema.optional(),
    messages: z.array(messageSchema),
    characterId: z.string().optional(),
    personaId: z.string().optional(),
    // The chat's own setting values, by key (user-owned, see chat-settings.ts). Absent in older files:
    // read as `session.settings ?? {}`. Keys the workflow doesn't declare are kept, unused.
    settings: z.record(z.string(), z.unknown()).optional(),
    // What the chat's settled turns stored (see state/). Absent in older files, and stored records are not
    // parsed on read: read the entries through `readTurnEntries`, never as `session.state.turns`.
    state: sessionStateSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
/**
 * One HTTP exchange as it went over the wire: what an LLM node actually sent (credentials redacted by
 * the adapter) and what came back. Recorded before the request, then again once the response is known.
 */
export const wireExchangeSchema = z
  .object({
    url: z.string(),
    method: z.string(),
    headers: z.record(z.string(), z.string()),
    // The exact JSON body that was sent.
    body: z.unknown(),
    // Absent while no response has arrived (e.g. a timeout before any byte).
    status: z.number().optional(),
    // The response JSON (or its text when it is not JSON); a stream's chunks folded into one object.
    response: z.unknown().optional(),
  })
  .passthrough();
export const nodeExecutionSchema = z
  .object({
    /** Display name (`Label #k (type)`) stamped at run time; absent in older logs. */
    name: z.string().optional(),
    status: z.enum(['running', 'completed', 'skipped', 'cancelled', 'error']),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    durationMs: z.number().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    /** Lines the node logged with `ctx.log`, in order; absent when it logged nothing. */
    logs: z.array(z.string()).optional(),
    /** The canonical LLM request; only in logs written before the wire log existed. */
    request: z.unknown().optional(),
    /** What an LLM node actually sent and received. */
    wire: wireExchangeSchema.optional(),
  })
  .passthrough();
export const executionLogSchema = z
  .object({
    id: z.string(),
    workflowId: z.string(),
    sessionId: z.string(),
    status: z.enum(['running', 'completed', 'error']),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    /** Seed of every node's `ctx.random()` in this run; absent in older logs. */
    seed: z.string().optional(),
    /** The resolved chat settings the run used; absent in older logs. */
    settings: z.record(z.string(), z.unknown()).optional(),
    /** `post` for a run of a turn's after section (the workflows below the last one that replies); absent for a reply-section run. */
    part: z.enum(['reply', 'post']).optional(),
    /** On a post run's log: the execution id of the turn it belongs to. */
    turnExecutionId: z.string().optional(),
    nodes: z.record(z.string(), nodeExecutionSchema),
    warnings: z.array(z.string()).default([]),
  })
  .passthrough();
export const dataTypeSchema = z.enum(portDataTypes);
export const portSchema = z.object({
  name: z.string(),
  label: z.string(),
  dataType: dataTypeSchema.default('any'),
  description: z.string().optional(),
  required: z.boolean().optional(),
  requiredIfConnected: z.boolean().optional(),
  neverSkips: z.boolean().optional(),
  optional: z.boolean().optional(),
});
export const nodeTypeDescriptorSchema = z.object({
  type: z.string(),
  label: z.string(),
  description: z.string(),
  category: z.string(),
  dynamicPorts: z.boolean(),
  /** Runs, with its upstream, even when no Chat Output needs it. Always sent by the server. */
  sink: z.boolean().optional(),
  inputs: z.array(portSchema),
  outputs: z.array(portSchema),
  configSchema: z.record(z.string(), z.unknown()),
  defaultConfig: z.record(z.string(), z.unknown()),
  templateFields: z.array(z.string()).optional(),
});
export type Workflow = z.infer<typeof workflowSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type NodeInstance = z.infer<typeof nodeSchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type ExecutionLog = z.infer<typeof executionLogSchema>;
export type WireExchange = z.infer<typeof wireExchangeSchema>;
export type NodeTypeDescriptor = z.infer<typeof nodeTypeDescriptorSchema>;
