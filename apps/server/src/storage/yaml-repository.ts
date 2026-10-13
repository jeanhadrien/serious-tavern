import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isMap, parseDocument } from 'yaml';
import { KeyedLock } from './lock.js';
import { atomicWrite, type Repository } from './repository.js';
import { allocateYamlFile, fileStem, isYamlFile, yamlFileStem } from './yaml-filenames.js';

/** What every YAML-stored record carries: identity and the name its file is named after (plus timestamps). */
export type YamlRecord = { id: string; name: string };

/** A file the directory scan skipped, and the plain-language reason. */
export type InvalidFile = { file: string; reason: string };

export type ParsedYaml<T> =
  | { ok: true; item: T }
  // `needsStamp`: structurally valid, only lacking id/timestamps, which the repository adds in place.
  | { ok: false; reason: string; needsStamp?: boolean };

/** How one kind of record reads from and writes to YAML text. */
export interface YamlCodec<T> {
  /** Singular noun for log messages ("preset", "provider"). */
  label: string;
  /** File stem for records whose name has no letters or digits. */
  fallbackStem: string;
  parse(text: string): ParsedYaml<T>;
  serialize(item: T): string;
}

interface RecordFile<T> {
  file: string;
  item: T;
}

/**
 * Records as YAML files named after the record. Identity is the `id` inside the file, never the file name,
 * so users may rename or hand-edit files while the server runs: nothing is cached, every operation scans
 * the directory. Reads never modify user files, except stamping a missing id/timestamps into a valid file.
 */
export class YamlRepository<T extends YamlRecord> implements Repository<T> {
  // Keys: `id:<record id>`, `names` (file name allocation) and `file:<name>` (stamping). Always taken in
  // that order, and never re-entrantly.
  private readonly locks = new KeyedLock();
  private readonly warned = new Map<string, string>();
  constructor(
    readonly directory: string,
    private readonly codec: YamlCodec<T>,
  ) {}

  async list(): Promise<T[]> {
    return (await this.scan()).files.map((entry) => entry.item);
  }

  /** The files the last directory scan skipped (bad YAML, schema errors, duplicate ids) and why. */
  async listInvalid(): Promise<InvalidFile[]> {
    return (await this.scan()).invalid;
  }

  async get(id: string): Promise<T | undefined> {
    return (await this.scan()).files.find((entry) => entry.item.id === id)?.item;
  }

  async save(item: T): Promise<void> {
    await this.locks.run(`id:${item.id}`, () => this.write(item));
  }

  async update(id: string, mutator: (current: T) => T | Promise<T>): Promise<T | undefined> {
    return this.locks.run(`id:${id}`, async () => {
      const current = await this.get(id);
      if (!current) return undefined;
      const updated = await mutator(current);
      if (updated.id !== id) throw new Error('Repository update cannot change an item id');
      return this.write(updated);
    });
  }

  async delete(id: string, beforeDelete?: (current: T | undefined) => void | Promise<void>): Promise<void> {
    await this.locks.run(`id:${id}`, async () => {
      const found = (await this.scan()).files.find((entry) => entry.item.id === id);
      if (beforeDelete) await beforeDelete(found?.item);
      if (found) await rm(join(this.directory, found.file), { force: true });
    });
  }

  // Warns once per (file, reason) so repeated scans do not flood the log.
  private warn(file: string, reason: string) {
    if (this.warned.get(file) === reason) return;
    this.warned.set(file, reason);
    console.warn(`Skipping ${this.codec.label} file ${join(this.directory, file)}: ${reason}`);
  }

  // One pass over the directory: the loadable records and the files skipped with their reasons.
  private async scan(): Promise<{ files: RecordFile<T>[]; invalid: InvalidFile[] }> {
    await mkdir(this.directory, { recursive: true });
    const names = (await readdir(this.directory)).filter(isYamlFile).sort();
    const files: RecordFile<T>[] = [];
    const invalid: InvalidFile[] = [];
    const ids = new Map<string, string>();
    const skip = (file: string, reason: string) => {
      this.warn(file, reason);
      invalid.push({ file, reason });
    };
    for (const file of names) {
      const loaded = await this.load(file);
      // A file that vanished mid-scan is neither a record nor invalid.
      if (!loaded) continue;
      if ('reason' in loaded) {
        skip(file, loaded.reason);
        continue;
      }
      const { item } = loaded;
      const owner = ids.get(item.id);
      if (owner) {
        skip(file, `duplicate ${this.codec.label} id ${item.id}, already used by ${owner}`);
        continue;
      }
      ids.set(item.id, file);
      this.warned.delete(file);
      files.push({ file, item });
    }
    return { files, invalid };
  }

  private async load(file: string): Promise<{ item: T } | { reason: string } | undefined> {
    let text: string;
    try {
      text = await readFile(join(this.directory, file), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      return { reason: (error as Error).message };
    }
    let result = this.codec.parse(text);
    if (!result.ok && result.needsStamp) {
      try {
        result = this.codec.parse(await this.stamp(file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        return { reason: `could not stamp id: ${(error as Error).message}` };
      }
    }
    return result.ok ? { item: result.item } : { reason: result.reason };
  }

  // Adds a missing id and timestamps to a file that is otherwise a valid record, keeping the user's
  // formatting and comments. Re-reads under a per-file lock so concurrent scans stamp only once.
  private stamp(file: string): Promise<string> {
    return this.locks.run(`file:${file}`, async () => {
      const path = join(this.directory, file);
      const text = await readFile(path, 'utf8');
      const doc = parseDocument(text);
      if (doc.errors.length || !isMap(doc.contents)) throw new Error('not a YAML mapping');
      const date = new Date().toISOString();
      let changed = false;
      for (const [key, value] of [
        ['id', randomUUID()],
        ['createdAt', date],
        ['updatedAt', date],
      ] as const) {
        if (doc.get(key) != null) continue;
        doc.set(key, value);
        changed = true;
      }
      if (!changed) return text;
      const stamped = doc.toString({ lineWidth: 0 });
      await atomicWrite(path, stamped);
      return stamped;
    });
  }

  // Writes the record to its file, renaming it when the name changed. Returns the record as read back
  // from the written text, so callers see exactly what is on disk. Must run inside the record's id lock.
  private async write(item: T): Promise<T> {
    const text = this.codec.serialize(item);
    const reread = this.codec.parse(text);
    if (!reread.ok) throw new Error(`${this.codec.label} ${item.id} cannot be stored: ${reread.reason}`);
    await this.locks.run('names', async () => {
      const existing = (await this.scan()).files.find((entry) => entry.item.id === item.id);
      const { fallbackStem } = this.codec;
      const stem = yamlFileStem(item.name, fallbackStem);
      let file = existing?.file;
      if (!existing || yamlFileStem(existing.item.name, fallbackStem) !== stem) {
        const names = await readdir(this.directory);
        const taken = new Set(names.filter(isYamlFile).map(fileStem));
        file = allocateYamlFile(stem, taken);
      }
      await atomicWrite(join(this.directory, file!), text);
      if (existing && existing.file !== file) await rm(join(this.directory, existing.file), { force: true });
    });
    return reread.item;
  }
}
