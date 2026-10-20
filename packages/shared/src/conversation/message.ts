import { z } from 'zod';

export const conversationRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

// One call the model made. Unknown fields (Gemini's thought signature lives on the call) are kept and
// sent back verbatim; `arguments` is the raw JSON text the model produced, never re-serialized.
export const toolCallSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('function'),
    function: z.object({ name: z.string(), arguments: z.string() }).passthrough(),
  })
  .passthrough();
export type ToolCall = z.infer<typeof toolCallSchema>;

// Which provider record, model and LLM node produced an assistant message.
export const provenanceSchema = z
  .object({ providerId: z.string(), model: z.string(), nodeId: z.string() })
  .passthrough();
export type Provenance = z.infer<typeof provenanceSchema>;

/**
 * The app's one message: an OpenAI Chat Completions message plus the app-only fields `reasoning`,
 * `provider_data` (message-level fields the backend needs back) and `provenance`. `content` is always a
 * string: an assistant message that only calls tools has `''` (the adapter sends `null` for it).
 * Tool field names keep the wire's snake_case on purpose, so a stored thread reads as an OpenAI conversation.
 */
export const conversationMessageSchema = z
  .object({
    role: conversationRoleSchema,
    content: z.string(),
    name: z.string().optional(),
    tool_calls: z.array(toolCallSchema).optional(),
    tool_call_id: z.string().optional(),
    reasoning: z.string().optional(),
    provider_data: z.record(z.string(), z.unknown()).optional(),
    provenance: provenanceSchema.optional(),
  })
  .passthrough()
  .refine((message) => message.role !== 'tool' || !!message.tool_call_id, {
    message: 'A tool message needs the tool_call_id of the call it answers',
    path: ['tool_call_id'],
  })
  .refine((message) => message.tool_calls === undefined || message.role === 'assistant', {
    message: 'Only an assistant message can have tool_calls',
    path: ['tool_calls'],
  });
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

/** The final answer of an exchange (the messages one LLM node run produced): its last message, `''` when there is none. */
export function exchangeText(exchange: readonly ConversationMessage[]): string {
  const last = exchange.at(-1);
  return last?.role === 'assistant' ? last.content : '';
}
