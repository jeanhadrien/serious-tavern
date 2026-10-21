import { z } from 'zod';
import { sessionSchema, messageSchema, executionLogSchema } from '../models.js';
import { replyEntrySchema } from '../triggers.js';
import { endpoint, errorEnvelopeSchema, idParamsSchema, noContentSchema } from './common.js';

export const sessionSummarySchema = sessionSchema
  .omit({ messages: true, state: true })
  .extend({ messageCount: z.number() });
// A reply list as a request writes it. Its rules (at least one entry, no repeated workflow) are answered as
// `400 TRIGGERS_INVALID` by the server, one code for every list problem; an unknown workflow is `404`.
const triggersWriteSchema = z.object({
  reply: z.array(replyEntrySchema.extend({ workflowId: z.string().uuid() })),
});
export const createSessionSchema = z
  .object({
    // Exactly one of `workflowId` (a chat that runs one workflow: its reply list is just that) and `triggers` is given.
    workflowId: z.string().uuid().optional(),
    triggers: triggersWriteSchema.optional(),
    title: z.string().trim().min(1).optional(),
    characterId: z.string().uuid().optional(),
    personaId: z.string().uuid().optional(),
  })
  .refine((body) => (body.workflowId === undefined) !== (body.triggers === undefined), {
    message: 'Give either workflowId or triggers, not both and not neither',
  });
export const updateSessionSchema = z.object({
  title: z.string().trim().min(1).optional(),
  // The chat's workflows (`session.triggers`, see triggers.ts): a whole replace of the reply list, at least one entry.
  // The legacy `workflowId` replaces the list with that workflow alone, enabled. Both in one patch is
  // `400 TRIGGERS_INVALID`, as is a repeated workflow. The first entry is mirrored into `session.workflowId`.
  triggers: triggersWriteSchema.optional(),
  workflowId: z.string().uuid().optional(),
  characterId: z.string().uuid().nullable().optional(),
  personaId: z.string().uuid().nullable().optional(),
  // Chat settings: a partial map merged into the stored values; `null` removes a key (back to its default).
  // Values are checked on the server against the settings every listed workflow declares together (the first declaration
  // of a key wins), as they are after this patch. Never advances `updatedAt`.
  settings: z.record(z.string(), z.unknown().nullable()).optional(),
});
// An empty `content` sends no user message: the turn runs on the session's history as it is.
export const sendMessageSchema = z.object({ content: z.string().trim().default('') });
// Editing a stored message may never leave it empty.
export const editMessageSchema = z.object({ content: z.string().trim().min(1) });
// Swipe: show another alternative of the chat's last turn (alternatives.ts). `executionId` is the alternative's own.
export const setAlternativeSchema = z.object({ executionId: z.string().min(1) });
// Fork: a new chat holding this chat up to (and including) the turn of this reply (fork.ts). `messageId` must be one of
// `forkPoints`: the last shown reply of a turn.
export const forkSessionSchema = z.object({ messageId: z.string().min(1) });
const messageParamsSchema = idParamsSchema.extend({ messageId: z.string().uuid() });
export const sendMessageResultSchema = z.object({
  // Absent when the turn was sent empty.
  userMessage: messageSchema.optional(),
  assistantMessages: z.array(messageSchema),
  // The first run's log on success, the failing run's log on failure. Absent when no workflow of the chat's list has a
  // Chat Output: the reply section is empty, and every workflow runs after the result (see `executions`).
  execution: executionLogSchema.optional(),
  // The log of every run of the reply section, in order (the workflows down to the last one that replies). The runs after
  // the result have their own logs (`GET /api/executions/:id`, the ids are in the state view's `runs`).
  executions: z.array(executionLogSchema).optional(),
});
// `details` of a failed or stopped turn (`WORKFLOW_EXECUTION_FAILED`, `TURN_STOPPED`): what was saved before it ended.
export const turnFailureDetailsSchema = sendMessageResultSchema.extend({
  aborted: z.enum(['user', 'disconnect', 'shutdown']).optional(),
});
export type TurnFailureDetails = z.infer<typeof turnFailureDetailsSchema>;
// One Server-Sent Event per item of `streamTurn`; the event name is the `type` field.
// `turn.error` reuses the standard error envelope, whose details use the same shape as a failed send.
export const turnEventSchema = z.discriminatedUnion('type', [
  // The turn's id: the execution id of its first run.
  z.object({ type: z.literal('turn.start'), executionId: z.string() }),
  // Before each run's node events (one run per enabled workflow, one after another). Its node events carry the `runId`.
  z.object({ type: z.literal('run.start'), runId: z.string(), workflowId: z.string(), workflowName: z.string() }),
  z.object({ type: z.literal('node.start'), nodeId: z.string(), runId: z.string().optional() }),
  z.object({
    type: z.literal('node.delta'),
    nodeId: z.string(),
    runId: z.string().optional(),
    // True: clear the row's text first, then append `textDelta` (a tool-using model moved on to its next step, and
    // only the last step's text is the answer). The row's reasoning is never reset.
    reset: z.boolean().optional(),
    textDelta: z.string().optional(),
    reasoningDelta: z.string().optional(),
  }),
  z.object({ type: z.literal('node.complete'), nodeId: z.string(), runId: z.string().optional() }),
  sendMessageResultSchema.extend({ type: z.literal('turn.complete') }),
  errorEnvelopeSchema.extend({ type: z.literal('turn.error') }),
]);
export const sessionEndpoints = {
  listSessions: endpoint({ method: 'GET', path: '/api/sessions' }, z.array(sessionSummarySchema)),
  createSession: endpoint({ method: 'POST', path: '/api/sessions' }, sessionSchema, createSessionSchema),
  getSession: endpoint({ method: 'GET', path: '/api/sessions/:id' }, sessionSchema, undefined, idParamsSchema),
  updateSession: endpoint(
    { method: 'PATCH', path: '/api/sessions/:id' },
    sessionSchema,
    updateSessionSchema,
    idParamsSchema,
  ),
  deleteSession: endpoint({ method: 'DELETE', path: '/api/sessions/:id' }, noContentSchema, undefined, idParamsSchema),
  sendMessage: endpoint(
    { method: 'POST', path: '/api/sessions/:id/messages' },
    sendMessageResultSchema,
    sendMessageSchema,
    idParamsSchema,
  ),
  streamTurn: endpoint(
    { method: 'POST', path: '/api/sessions/:id/messages/stream' },
    turnEventSchema,
    sendMessageSchema,
    idParamsSchema,
  ),
  // Regenerate the last turn: a turn that stores no user message (same result and events as a send).
  regenerate: endpoint(
    { method: 'POST', path: '/api/sessions/:id/regenerate' },
    sendMessageResultSchema,
    undefined,
    idParamsSchema,
  ),
  streamRegenerate: endpoint(
    { method: 'POST', path: '/api/sessions/:id/regenerate/stream' },
    turnEventSchema,
    undefined,
    idParamsSchema,
  ),
  // Swipe: the whole session, as `updateSession` answers.
  setAlternative: endpoint(
    { method: 'PATCH', path: '/api/sessions/:id/alternative' },
    sessionSchema,
    setAlternativeSchema,
    idParamsSchema,
  ),
  // Fork: the new session, with `forkedFrom` set. The source chat is not changed.
  forkSession: endpoint(
    { method: 'POST', path: '/api/sessions/:id/fork' },
    sessionSchema,
    forkSessionSchema,
    idParamsSchema,
  ),
  stopTurn: endpoint({ method: 'POST', path: '/api/sessions/:id/stop' }, noContentSchema, undefined, idParamsSchema),
  updateMessage: endpoint(
    { method: 'PATCH', path: '/api/sessions/:id/messages/:messageId' },
    messageSchema,
    editMessageSchema,
    messageParamsSchema,
  ),
  deleteMessage: endpoint(
    { method: 'DELETE', path: '/api/sessions/:id/messages/:messageId' },
    noContentSchema,
    undefined,
    messageParamsSchema,
  ),
  getExecution: endpoint({ method: 'GET', path: '/api/executions/:id' }, executionLogSchema, undefined, idParamsSchema),
};
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
