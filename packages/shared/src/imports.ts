import { z } from 'zod';

// Connectors import content from other apps. Each connector keeps one config record whose id is its app.
export const importAppSchema = z.enum(['sillytavern']);
export type ImportApp = z.infer<typeof importAppSchema>;

export const importSourceSchema = z
  .object({
    id: importAppSchema,
    app: importAppSchema,
    path: z.string().min(1),
    lastSyncAt: z.string().optional(),
  })
  .passthrough();
export type ImportSource = z.infer<typeof importSourceSchema>;

export const importSyncResultSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
});
export type ImportSyncResult = z.infer<typeof importSyncResultSchema>;
