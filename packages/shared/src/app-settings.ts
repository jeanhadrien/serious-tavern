import { z } from 'zod';

/**
 * App-wide preferences (not per chat). `.catch` makes every field tolerant: a missing value or one of the wrong type reads
 * as its default, and unknown keys are kept so a newer file survives an older server.
 */
export const appSettingsSchema = z
  .object({
    /** Whether a forked chat keeps the alternatives (regenerations) of the reply it starts from. */
    forkKeepsAlternatives: z.boolean().catch(true),
    /** Whether the chat shows the text statistics (word count, MTLD, repetition...) of each assistant reply. */
    showMessageStats: z.boolean().catch(false),
  })
  .passthrough();
export type AppSettings = z.infer<typeof appSettingsSchema>;

/** The settings of a stored value. Never throws: anything that is not an object gives the defaults. */
export function readAppSettings(raw: unknown): AppSettings {
  const parsed = appSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : appSettingsSchema.parse({});
}
