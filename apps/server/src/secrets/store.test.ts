import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SecretStore } from './store.js';

it('serializes concurrent secret sets and deletes without losing unrelated credentials', async () => {
  const directory = join(process.cwd(), '.test-data', `secrets-${randomUUID()}`);
  const store = new SecretStore(directory);
  try {
    await store.init();
    for (let index = 0; index < 20; index++) await store.set(`old-${index}`, `original-${index}`);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) => [
        store.set(`new-${index}`, `new-value-${index}`),
        store.set(`old-${index + 10}`, `updated-${index}`),
        store.delete(`old-${index}`),
      ]).flat(),
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect((await store.list()).map(({ name }) => name).sort()).toEqual(
      Array.from({ length: 10 }, (_, index) => [`new-${index}`, `old-${index + 10}`])
        .flat()
        .sort(),
    );
    for (let index = 0; index < 10; index++) {
      expect(await store.get(`new-${index}`)).toBe(`new-value-${index}`);
      expect(await store.get(`old-${index + 10}`)).toBe(`updated-${index}`);
      expect(await store.get(`old-${index}`)).toBeUndefined();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
