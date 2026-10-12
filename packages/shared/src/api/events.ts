import { z } from 'zod';
import { endpoint } from './common.js';

/** A preset file the server skipped, with the plain-language reason (bad YAML, schema error, duplicate id...). */
export const invalidPresetFileSchema = z.object({ file: z.string(), reason: z.string() });
export type InvalidPresetFile = z.infer<typeof invalidPresetFileSchema>;

// One Server-Sent Event per item of `streamChanges`; the event name is the `type` field.
// Events say that a resource changed on disk (clients re-fetch it), never carry the resource itself.
// The server sends the current state of every event type once on connect, so reconnecting clients resync.
export const changeEventSchema = z.discriminatedUnion('type', [
  // The preset files changed; `invalidFiles` lists the files the server could not load (empty when all are fine).
  z.object({ type: z.literal('presets.changed'), invalidFiles: z.array(invalidPresetFileSchema) }),
]);
export type ChangeEvent = z.infer<typeof changeEventSchema>;
export const changeEventTypes: ChangeEvent['type'][] = changeEventSchema.options.map(
  (option) => option.shape.type.value,
);

export const eventEndpoints = {
  streamChanges: endpoint(changeEventSchema),
};
