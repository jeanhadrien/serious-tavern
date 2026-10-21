import { z } from 'zod';

// The strictest rule common to the backends, so one name works everywhere.
export const toolNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'A tool name is 1 to 64 letters, digits, underscores or dashes');

// An OpenAI function tool. `parameters` is a JSON Schema object, not checked beyond being an object.
export const toolDefinitionSchema = z
  .object({
    type: z.literal('function'),
    function: z
      .object({
        name: toolNameSchema,
        description: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
