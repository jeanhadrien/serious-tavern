import { z } from 'zod';
import { sessionSchema, messageSchema, executionLogSchema } from '../models.js';
import { endpoint, idParamsSchema, noContentSchema } from './common.js';

export const sessionSummarySchema = sessionSchema.omit({ messages: true }).extend({ messageCount: z.number() });
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
});
export const sendMessageSchema = z.object({ content: z.string().trim().min(1) });
export const sendMessageResultSchema = z.object({
  userMessage: messageSchema,
  assistantMessages: z.array(messageSchema),
  execution: executionLogSchema,
});
export const sessionEndpoints = {
  listSessions: endpoint(z.array(sessionSummarySchema)),
  createSession: endpoint(sessionSchema, createSessionSchema),
  getSession: endpoint(sessionSchema, undefined, idParamsSchema),
  updateSession: endpoint(sessionSchema, updateSessionSchema, idParamsSchema),
  deleteSession: endpoint(noContentSchema, undefined, idParamsSchema),
  sendMessage: endpoint(sendMessageResultSchema, sendMessageSchema, idParamsSchema),
  getExecution: endpoint(executionLogSchema, undefined, idParamsSchema),
};
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
