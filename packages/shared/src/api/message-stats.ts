import { z } from 'zod';
import { endpoint, idParamsSchema } from './common.js';

/** Raw statistics on one assistant reply (see `packages/engine/src/text-stats`); a metric that is undefined for the text is `null`. */
export const textStatsSchema = z.object({
  words: z.number(),
  mtld: z.number().nullable(),
  /** Words found in the slop word list: a count, not a rate. */
  slopWords: z.number(),
  /** Share (0..1) of the reply's 4-grams that occur in the earlier replies; `null` with no earlier reply or no 4-gram. */
  ngramOverlap: z.number().nullable(),
  recycledSentences: z.number(),
});
export type TextStats = z.infer<typeof textStatsSchema>;

export const sessionStatsSchema = z.object({
  /** The `showMessageStats` app setting. When false nothing is computed and `messages` is empty. */
  enabled: z.boolean(),
  /** By message id, for the assistant replies of the chat as shown. User messages and streaming replies have none. */
  messages: z.record(z.string(), textStatsSchema),
});

export const messageStatsEndpoints = {
  // Computed on read, never stored. A stopped reply gets stats of its own but is never part of another reply's comparison.
  getSessionStats: endpoint(
    { method: 'GET', path: '/api/sessions/:id/stats' },
    sessionStatsSchema,
    undefined,
    idParamsSchema,
  ),
};
