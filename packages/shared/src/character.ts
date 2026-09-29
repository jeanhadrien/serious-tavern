import { z } from 'zod';

export const characterSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  description: z.string(),
  personality: z.string(),
  scenario: z.string(),
  first_mes: z.string(),
  mes_example: z.string(),
  creator_notes: z.string(),
  system_prompt: z.string(),
  post_history_instructions: z.string(),
  alternate_greetings: z.array(z.string()),
  tags: z.array(z.string()),
  creator: z.string(),
  character_version: z.string(),
  extensions: z.record(z.string(), z.unknown()),
  avatar: z.union([z.string(), z.boolean()]),
  createdAt: z.string(),
  updatedAt: z.string()
}).passthrough();

export const personaSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  description: z.string(),
  avatar: z.union([z.string(), z.boolean()]),
  createdAt: z.string(),
  updatedAt: z.string()
}).passthrough();

export type Character = z.infer<typeof characterSchema>;
export type Persona = z.infer<typeof personaSchema>;
