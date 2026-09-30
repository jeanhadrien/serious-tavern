import type { z } from 'zod';
import { now } from '../context.js';
import { notFound } from '../errors.js';
import type { Repository } from '../storage/repository.js';
import { removeAvatar, storeAvatar, type UploadedFile } from '../uploads.js';

type Entity = { id: string; avatar: string | boolean; createdAt: string; updatedAt: string };

export async function updateEntity<T extends Entity>(
  repository: Repository<T>,
  id: string,
  fields: Partial<T>,
  schema: z.ZodType<T>,
  resource: string,
): Promise<T> {
  const updated = await repository.update(id, (current) =>
    schema.parse({
      ...current,
      ...fields,
      id,
      avatar: current.avatar,
      createdAt: current.createdAt,
      updatedAt: now(),
    }),
  );
  if (!updated) throw notFound(resource);
  return updated;
}

export async function updateEntityAvatar<T extends Entity>(
  repository: Repository<T>,
  avatars: string,
  id: string,
  file: UploadedFile,
  resource: string,
): Promise<T> {
  const updated = await repository.update(id, async (current) => ({
    ...current,
    avatar: await storeAvatar(avatars, id, file),
    updatedAt: now(),
  }));
  if (!updated) throw notFound(resource);
  return updated;
}

export async function deleteEntity<T extends Entity>(
  repository: Repository<T>,
  avatars: string,
  id: string,
  resource: string,
): Promise<void> {
  // Avatar cleanup and deletion share update's lock; do not nest update/delete.
  await repository.delete(id, async (current) => {
    if (!current) throw notFound(resource);
    await removeAvatar(avatars, id);
  });
}
