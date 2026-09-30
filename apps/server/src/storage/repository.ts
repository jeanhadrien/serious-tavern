import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { KeyedLock } from './lock.js';

export interface Repository<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  save(item: T): Promise<void>;
  update(id: string, mutator: (current: T) => T | Promise<T>): Promise<T | undefined>;
  delete(id: string, beforeDelete?: (current: T | undefined) => void | Promise<void>): Promise<void>;
}
export async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { flag: 'wx' });
  try {
    await renameWithRetry(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
// On Windows, antivirus/indexers briefly hold freshly written files, so replacing them can fail
// transiently with EPERM/EACCES/EBUSY. Retry with a short backoff, like graceful-fs does.
async function renameWithRetry(from: string, to: string, attempts = 10): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
}
export class JsonRepository<T extends { id: string }> implements Repository<T> {
  private readonly locks = new KeyedLock();
  constructor(private readonly directory: string) {}
  private path(id: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid id');
    return join(this.directory, `${id}.json`);
  }
  async list(): Promise<T[]> {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter((name) => name.endsWith('.json'));
    return Promise.all(files.map(async (name) => JSON.parse(await readFile(join(this.directory, name), 'utf8')) as T));
  }
  async get(id: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async save(item: T): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await atomicWrite(this.path(item.id), JSON.stringify(item, null, 2));
  }
  async update(id: string, mutator: (current: T) => T | Promise<T>): Promise<T | undefined> {
    return this.locks.run(id, async () => {
      const current = await this.get(id);
      if (!current) return undefined;
      const updated = await mutator(current);
      if (updated.id !== id) throw new Error('Repository update cannot change an item id');
      await this.save(updated);
      return updated;
    });
  }
  async delete(id: string, beforeDelete?: (current: T | undefined) => void | Promise<void>): Promise<void> {
    await this.locks.run(id, async () => {
      if (beforeDelete) await beforeDelete(await this.get(id));
      await rm(this.path(id), { force: true });
    });
  }
}
