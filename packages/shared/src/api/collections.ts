import { z } from 'zod';
import { collectionSchema, collectionWriteSchema } from '../collection.js';
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
  listCollections: endpoint(
    { method: 'GET', path: '/api/collections', description: 'List collections (summaries, without entries).' },
    z.array(collectionSummarySchema),
  ),
  getCollection: endpoint(
    { method: 'GET', path: '/api/collections/:id', description: 'Get one collection with its entries.' },
    collectionSchema,
    undefined,
    idParamsSchema,
  ),
  createCollection: endpoint({ method: 'POST', path: '/api/collections' }, collectionSchema, collectionWriteSchema),
  // Replaces name, description and entries; unknown top-level fields of the stored record survive.
  updateCollection: endpoint(
    { method: 'PUT', path: '/api/collections/:id' },
    collectionSchema,
    collectionWriteSchema,
    idParamsSchema,
  ),
  // 409 `COLLECTION_IN_USE` (details: the workflow names) while a Recall or Draw node reads it.
  deleteCollection: endpoint(
    { method: 'DELETE', path: '/api/collections/:id' },
    noContentSchema,
    undefined,
    idParamsSchema,
  ),
};
