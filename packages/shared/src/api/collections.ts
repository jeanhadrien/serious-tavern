import { z } from 'zod';
import { collectionFieldsSchema, collectionSchema } from '../collection.js';
import { endpoint, idParamsSchema, noContentSchema } from './common.js';

/** A collection as the list shows it: entries are counted, not sent (collections can be large). */
export const collectionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  entryCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

export const collectionEndpoints = {
  // Summaries in file-name order; clients sort.
  listCollections: endpoint(z.array(collectionSummarySchema)),
  getCollection: endpoint(collectionSchema, undefined, idParamsSchema),
  createCollection: endpoint(collectionSchema, collectionFieldsSchema),
  // Replaces name, description and entries; unknown top-level fields of the stored record survive.
  updateCollection: endpoint(collectionSchema, collectionFieldsSchema, idParamsSchema),
  // 409 `COLLECTION_IN_USE` (details: the workflow names) while a Recall or Draw node reads it.
  deleteCollection: endpoint(noContentSchema, undefined, idParamsSchema),
};
