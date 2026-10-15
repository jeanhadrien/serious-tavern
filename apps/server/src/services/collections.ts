import { randomUUID } from 'node:crypto';
import { collectionSchema, type ApiParsedBody, type Collection, type CollectionSummary } from '@st/shared';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound } from '../errors.js';
import { publishFileChange } from './change-events.js';

type CollectionBody = ApiParsedBody<'createCollection'>;

// API writes announce themselves with a fresh scan, so clients update even when no file watcher runs and a
// still-broken file stays listed (the watcher, when on, announces the same write again, which is harmless).
const announce = (context: AppContext) => publishFileChange(context.changes, 'collections', context.collections);

// Client bodies may echo a whole record or summary back; identity, timestamps and counts are never client-owned.
const BOOKKEEPING = ['id', 'createdAt', 'updatedAt', 'entryCount'];
const writableFields = (body: CollectionBody): CollectionBody =>
  Object.fromEntries(Object.entries(body).filter(([key]) => !BOOKKEEPING.includes(key))) as CollectionBody;

const toSummary = ({ id, name, description, entries, createdAt, updatedAt }: Collection): CollectionSummary => ({
  id,
  name,
  ...(description !== undefined && { description }),
  entryCount: entries.length,
  createdAt,
  updatedAt,
});

export async function listCollections({ collections }: AppContext): Promise<CollectionSummary[]> {
  return (await collections.list()).map(toSummary);
}

export async function getCollection({ collections }: AppContext, id: string): Promise<Collection> {
  const collection = await collections.get(id);
  if (!collection) throw notFound('Collection');
  return collection;
}

export async function createCollection(context: AppContext, body: CollectionBody): Promise<Collection> {
  const date = now();
  const collection = collectionSchema.parse({
    ...writableFields(body),
    id: randomUUID(),
    createdAt: date,
    updatedAt: date,
  });
  await context.collections.save(collection);
  await announce(context);
  // Answer with the stored form, like PUT and later GETs.
  return getCollection(context, collection.id);
}

export async function updateCollection(context: AppContext, id: string, body: CollectionBody): Promise<Collection> {
  // Old fields first so unknown top-level ones survive (migrate-on-write); a body without `description` clears it.
  const updated = await context.collections.update(id, (old) =>
    collectionSchema.parse({
      ...old,
      description: undefined,
      ...writableFields(body),
      id,
      createdAt: old.createdAt,
      updatedAt: now(),
    }),
  );
  if (!updated) throw notFound('Collection');
  await announce(context);
  return updated;
}

const readsCollections = new Set(['recall', 'draw']);

/** Workflows whose Recall or Draw nodes read the collection, so deleting it can be refused. */
async function workflowsUsing({ workflows }: AppContext, id: string): Promise<string[]> {
  return (await workflows.list())
    .filter((workflow) =>
      workflow.nodes.some((node) => {
        const ids = node.config?.collectionIds;
        return readsCollections.has(node.type) && Array.isArray(ids) && ids.includes(id);
      }),
    )
    .map((workflow) => workflow.name);
}

export async function deleteCollection(context: AppContext, id: string): Promise<void> {
  await getCollection(context, id);
  const users = await workflowsUsing(context, id);
  if (users.length) throw new HttpError(409, 'COLLECTION_IN_USE', 'Collection is used by workflows', users);
  await context.collections.delete(id);
  await announce(context);
}
