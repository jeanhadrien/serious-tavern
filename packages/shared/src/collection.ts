import { z } from 'zod';

// Authored collections (lorebooks and decks): entries the user writes, which workflows only read.
// Records keep unknown fields (record and entry), so imported formats round-trip. Collections are read through
// the YAML codec, which parses every file on read, so `.default()` is safe here: consumers always see concrete
// values. (JsonRepository records are not parsed on read; there, new fields must stay `.optional()`.)

/** One entry. Entries have no stored id: see `collectionEntryId`. */
export const collectionEntrySchema = z
  .object({
    // Required, may be multi-line. Recall and Draw skip entries whose text is blank.
    text: z.string(),
    title: z.string().optional(),
    // Recall: the entry is recalled when any keyword appears in the recent chat.
    keywords: z.array(z.string()).optional(),
    // Draw: filters by tags (compared trimmed and case-insensitively).
    tags: z.array(z.string()).optional(),
    // Intensity, 1 (gentle) to 5.
    level: z.number().int().min(1).max(5).optional(),
    // Draw: relative chance; 0 means never drawn.
    weight: z.number().min(0).default(1),
    enabled: z.boolean().default(true),
  })
  .passthrough();
export type CollectionEntry = z.infer<typeof collectionEntrySchema>;

/** The editable fields of a stored record: a hand-written file may leave out `entries`. */
export const collectionFieldsSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required'),
    description: z.string().optional(),
    entries: z.array(collectionEntrySchema).default([]),
  })
  .passthrough();

/**
 * What a client writes: everything but identity and timestamps. `entries` is required here, because a write
 * replaces them and a body that left them out would silently erase every entry.
 */
export const collectionWriteSchema = collectionFieldsSchema
  .extend({ entries: z.array(collectionEntrySchema) })
  .passthrough();
export type CollectionFields = z.input<typeof collectionWriteSchema>;

/** A stored collection (`data/collections/*.yaml`). */
export const collectionSchema = collectionFieldsSchema
  .extend({ id: z.string().uuid(), createdAt: z.string(), updatedAt: z.string() })
  .passthrough();
export type Collection = z.infer<typeof collectionSchema>;

/**
 * An entry's id: its 1-based position (`entry-<n>`), derived on read and never stored. Reordering or
 * inserting entries changes it, so nothing may rely on it surviving a save.
 */
export const collectionEntryId = (index: number) => `entry-${index + 1}`;
