import { z } from 'zod';
import { endpoint } from './common.js';

/** A YAML file (preset, provider, collection, state definition) the server skipped, with the plain-language reason (bad YAML, schema error, duplicate id...). */
export const invalidFileSchema = z.object({ file: z.string(), reason: z.string() });
export type InvalidFile = z.infer<typeof invalidFileSchema>;

// One Server-Sent Event per item of `streamChanges`; the event name is the `type` field.
// Events say that a resource changed (clients re-fetch it), never carry the resource itself.
// The server sends the current state of every event type once on connect, so reconnecting clients resync.
/** A record-based resource changed through the API; `id` is the affected record when known (none on the connect snapshot). */
const resourceChanged = <Type extends string>(type: Type) =>
  z.object({ type: z.literal(type), id: z.string().optional() });

export const changeEventSchema = z.discriminatedUnion('type', [
  // The preset files changed; `invalidFiles` lists the files the server could not load (empty when all are fine).
  z.object({ type: z.literal('presets.changed'), invalidFiles: z.array(invalidFileSchema) }),
  // The provider files changed on disk or through the API; same shape as presets.
  z.object({ type: z.literal('providers.changed'), invalidFiles: z.array(invalidFileSchema) }),
  // The collection files changed on disk or through the API; same shape as presets.
  z.object({ type: z.literal('collections.changed'), invalidFiles: z.array(invalidFileSchema) }),
  // The state definition files changed on disk or through the API; same shape as presets.
  z.object({ type: z.literal('stateDefinitions.changed'), invalidFiles: z.array(invalidFileSchema) }),
  // Created, updated or deleted through the API (avatars and imports included). Sessions also change when a
  // turn settles and when a message is edited or deleted; streamed tokens never emit.
  resourceChanged('workflows.changed'),
  resourceChanged('characters.changed'),
  resourceChanged('personas.changed'),
  resourceChanged('sessions.changed'),
  // The app settings changed through `PATCH /api/app-settings` (a single record: no id).
  z.object({ type: z.literal('appSettings.changed') }),
]);
export type ChangeEvent = z.infer<typeof changeEventSchema>;
export const changeEventTypes: ChangeEvent['type'][] = changeEventSchema.options.map(
  (option) => option.shape.type.value,
);

export const eventEndpoints = {
  streamChanges: endpoint(changeEventSchema),
};
