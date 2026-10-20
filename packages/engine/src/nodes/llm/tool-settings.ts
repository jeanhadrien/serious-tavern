import { z } from 'zod';
import { replayPolicies } from './replay.js';

const stateTarget = z.object({ definitionId: z.string(), key: z.string() });

/**
 * The LLM node settings about tools and the loop. Every field has a default, so a node saved before they existed
 * (or a config nobody parsed) reads as no tools and one call.
 */
export const toolSettingsSchema = z.object({
  tools: z
    .object({
      read: z.array(stateTarget).default([]).describe('State keys the model may read, through a read_state tool'),
      write: z
        .array(stateTarget)
        .default([])
        .describe('State keys the model may change, one write tool each; they follow the same rules as State Write'),
    })
    .default({ read: [], write: [] }),
  maxSteps: z
    .number()
    .int()
    .min(1)
    .default(5)
    .describe('Calls the model gets while it uses tools; after that it is asked for a final answer without them'),
  toolChoice: z
    .enum(['auto', 'required'])
    .default('auto')
    .describe('required makes the first call use a tool; later calls always let the model choose'),
  parallelToolCalls: z
    .boolean()
    .optional()
    .describe('Let the model send several tool calls at once; left unset, the backend decides'),
  replayReasoning: z
    .enum(replayPolicies)
    .default('never')
    .describe(
      'Send earlier reasoning back to the model, when this same provider and model wrote it: never, only after the last user message, or always. The tool loop of a call always keeps its own',
    ),
});
