import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
import { castNames, measureStagnation } from './measure.js';

type StagnationConfig = {
  window: number;
  ngram: number;
  repetitionWeight: number;
  churnWeight: number;
  repetitionFull: number;
};

const weight = (label: string) => z.number().min(0, `${label} can not be negative`);

const configSchema = z
  .object({
    window: z
      .number()
      .int()
      .min(2, 'The window needs at least 2 replies')
      .default(4)
      .describe('How many of the latest assistant replies to compare'),
    ngram: z
      .number()
      .int()
      .min(1, 'N-gram size goes from 1 to 8')
      .max(8, 'N-gram size goes from 1 to 8')
      .default(3)
      .describe('Words per n-gram when comparing two replies'),
    repetitionWeight: weight('Repetition weight').default(0.6).describe('Weight of the n-gram overlap in the score'),
    churnWeight: weight('Churn weight')
      .default(0.4)
      .describe('Weight of "no new names" in the score; ignored when the newest reply names nobody'),
    repetitionFull: z
      .number()
      .gt(0, 'Full repetition must be above 0')
      .max(1, 'Full repetition must be at most 1')
      .default(0.3)
      .describe('The average n-gram overlap that counts as fully repetitive (overlap is rarely high even in a loop)'),
  })
  .superRefine((config, issues) => {
    if (config.repetitionWeight + config.churnWeight <= 0)
      issues.addIssue({ code: 'custom', path: ['repetitionWeight'], message: 'At least one weight must be above 0' });
  });

const defaultConfig: Record<string, unknown> = {
  window: 4,
  ngram: 3,
  repetitionWeight: 0.6,
  churnWeight: 0.4,
  repetitionFull: 0.3,
};

/**
 * A deterministic stagnation signal for the Trigger: how repetitive and name-poor the latest assistant replies are.
 * No model, no state, no randomness; it only reads `ctx.history`. See `measureStagnation` for the formula.
 */
export const stagnation: NodeDefinition = {
  type: 'stagnation',
  label: 'Stagnation',
  description:
    'A 0 to 1 signal for how stuck the recent story is: word n-gram overlap between the last assistant replies, and how few new names the newest one brings. 1 is very stagnant. Wire Score into a Trigger signal',
  category: 'Creativity',
  inputs: [],
  outputs: [
    {
      name: 'score',
      label: 'Score',
      dataType: 'number',
      description: 'Stagnation, 0 to 1 (1 = very stagnant); 0 with fewer than 2 assistant replies',
    },
    {
      name: 'repetition',
      label: 'Repetition',
      dataType: 'number',
      description: 'Average n-gram overlap of consecutive replies, 0 to 1 (raw)',
    },
    {
      name: 'novelty',
      label: 'Novelty',
      dataType: 'number',
      description:
        "Share of the newest reply's names that earlier replies did not mention, 0 to 1; 1 when it names nobody",
    },
    {
      name: 'reason',
      label: 'Reason',
      dataType: 'text',
      description: 'The overlap and the names behind the score, in words',
    },
  ],
  configSchema,
  defaultConfig,
  async execute(ctx) {
    const config = ctx.config as StagnationConfig;
    // Never throws on a short history: the window just has fewer replies than it asks for.
    const assistant = ctx.history.filter(
      (message) => message.role === 'assistant' && message.inactive !== true && message.content.trim() !== '',
    );
    const window = assistant.slice(-config.window);
    const cast = castNames(ctx.character?.name, ctx.persona?.name, ...ctx.history.map((message) => message.name));
    const result = measureStagnation({ ...config, replies: window.map((message) => message.content), cast });
    return { score: result.score, repetition: result.repetition, novelty: result.novelty, reason: result.reason };
  },
};
