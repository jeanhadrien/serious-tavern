import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Repository<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  save(item: T): Promise<void>;
  update(id: string, mutator: (current: T) => T | Promise<T>): Promise<T | undefined>;
  delete(id: string): Promise<void>;
}
export async function atomicWrite(path: string, content: string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { flag: 'wx' });
  try { await rename(temp, path); } finally { await rm(temp, { force: true }); }
}
export class JsonRepository<T extends { id: string }> implements Repository<T> {
  private readonly locks = new Map<string, Promise<void>>();
  constructor(private readonly directory: string) {}
  private path(id: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid id');
    return join(this.directory, `${id}.json`);
  }
  async list(): Promise<T[]> {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter(name => name.endsWith('.json'));
    return Promise.all(files.map(async name => JSON.parse(await readFile(join(this.directory, name), 'utf8')) as T));
  }
  async get(id: string): Promise<T | undefined> {
    try { return JSON.parse(await readFile(this.path(id), 'utf8')) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  async save(item: T): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await atomicWrite(this.path(item.id), JSON.stringify(item, null, 2));
  }
  async update(id: string, mutator: (current: T) => T | Promise<T>): Promise<T | undefined> {
    return this.withLock(id, async () => {
      const current = await this.get(id);
      if (!current) return undefined;
      const updated = await mutator(current);
      if (updated.id !== id) throw new Error('Repository update cannot change an item id');
      await this.save(updated);
      return updated;
    });
  }
  async delete(id: string): Promise<void> {
    await this.withLock(id, () => rm(this.path(id), { force: true }));
  }
  private async withLock<R>(id: string, action: () => Promise<R>): Promise<R> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(id, current);
    await previous;
    try { return await action(); }
    finally {
      release();
      if (this.locks.get(id) === current) this.locks.delete(id);
    }
  }
}
