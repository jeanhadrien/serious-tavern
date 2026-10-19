import { z } from 'zod';
import { sessionSchema, messageSchema, executionLogSchema } from '../models.js';
import { endpoint, errorEnvelopeSchema, idParamsSchema, noContentSchema } from './common.js';

export const sessionSummarySchema = sessionSchema
  .omit({ messages: true, state: true })
  .extend({ messageCount: z.number() });
export const createSessionSchema = z.object({
  workflowId: z.string().uuid(),
  title: z.string().trim().min(1).optional(),
  characterId: z.string().uuid().optional(),
  personaId: z.string().uuid().optional(),
});
export const updateSessionSchema = z.object({
  title: z.string().trim().min(1).optional(),
  workflowId: z.string().uuid().optional(),
  characterId: z.string().uuid().nullable().optional(),
  personaId: z.string().uuid().nullable().optional(),
  // Chat settings: a partial map merged into the stored values; `null` removes a key (back to its default).
  // Values are checked against the workflow's declarations on the server. Never advances `updatedAt`.
  settings: z.record(z.string(), z.unknown().nullable()).optional(),
});
// An empty `content` sends no user message: the turn runs on the session's history as it is.
export const sendMessageSchema = z.object({ content: z.string().trim().default('') });
// Editing a stored message may never leave it empty.
export const editMessageSchema = z.object({ content: z.string().trim().min(1) });
// Swipe: show another alternative of the chat's last turn (alternatives.ts). `executionId` is the alternative's own.
export const setAlternativeSchema = z.object({ executionId: z.string().min(1) });
const messageParamsSchema = idParamsSchema.extend({ messageId: z.string().uuid() });
export const sendMessageResultSchema = z.object({
  // Absent when the turn was sent empty.
  userMessage: messageSchema.optional(),
  assistantMessages: z.array(messageSchema),
  execution: executionLogSchema,
});
// `details` of a failed or stopped turn (`WORKFLOW_EXECUTION_FAILED`, `TURN_STOPPED`): what was saved before it ended.
export const turnFailureDetailsSchema = sendMessageResultSchema.extend({
  aborted: z.enum(['user', 'disconnect', 'shutdown']).optional(),
});
export type TurnFailureDetails = z.infer<typeof turnFailureDetailsSchema>;
// One Server-Sent Event per item of `streamTurn`; the event name is the `type` field.
// `turn.error` reuses the standard error envelope, whose details use the same shape as a failed send.
export const turnEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turn.start'), executionId: z.string() }),
  z.object({ type: z.literal('node.start'), nodeId: z.string() }),
  z.object({
    type: z.literal('node.delta'),
    nodeId: z.string(),
    textDelta: z.string().optional(),
    reasoningDelta: z.string().optional(),
  }),
  z.object({ type: z.literal('node.complete'), nodeId: z.string() }),
  sendMessageResultSchema.extend({ type: z.literal('turn.complete') }),
  errorEnvelopeSchema.extend({ type: z.literal('turn.error') }),
]);
export const sessionEndpoints = {
  listSessions: endpoint(z.array(sessionSummarySchema)),
  createSession: endpoint(sessionSchema, createSessionSchema),
  getSession: endpoint(sessionSchema, undefined, idParamsSchema),
  updateSession: endpoint(sessionSchema, updateSessionSchema, idParamsSchema),
  deleteSession: endpoint(noContentSchema, undefined, idParamsSchema),
  sendMessage: endpoint(sendMessageResultSchema, sendMessageSchema, idParamsSchema),
  streamTurn: endpoint(turnEventSchema, sendMessageSchema, idParamsSchema),
  // Regenerate the last turn: a turn that stores no user message (same result and events as a send).
  regenerate: endpoint(sendMessageResultSchema, undefined, idParamsSchema),
  streamRegenerate: endpoint(turnEventSchema, undefined, idParamsSchema),
  // Swipe: the whole session, as `updateSession` answers.
  setAlternative: endpoint(sessionSchema, setAlternativeSchema, idParamsSchema),
  stopTurn: endpoint(noContentSchema, undefined, idParamsSchema),
  updateMessage: endpoint(messageSchema, editMessageSchema, messageParamsSchema),
  deleteMessage: endpoint(noContentSchema, undefined, messageParamsSchema),
  getExecution: endpoint(executionLogSchema, undefined, idParamsSchema),
};
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
