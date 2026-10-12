import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isMap, parseDocument } from 'yaml';
import type { InvalidPresetFile, Preset } from '@st/shared';
import { KeyedLock } from './lock.js';
import { atomicWrite, type Repository } from './repository.js';
import { allocatePresetFile, fileStem, isPresetFile, presetFileStem } from './preset-filenames.js';
import { parsePresetYaml, presetToYaml } from './preset-yaml.js';

interface PresetFile {
  file: string;
  preset: Preset;
}

/**
 * Presets as YAML files named after the preset. Identity is the `id` inside the file, never the file name,
 * so users may rename or hand-edit files while the server runs: nothing is cached, every operation scans
 * the directory. Reads never modify user files, except stamping a missing id/timestamps into a valid file.
 */
export class PresetRepository implements Repository<Preset> {
  // Keys: `id:<preset id>`, `names` (file name allocation) and `file:<name>` (stamping). Always taken in
  // that order, and never re-entrantly.
  private readonly locks = new KeyedLock();
  private readonly warned = new Map<string, string>();
  constructor(readonly directory: string) {}

  async list(): Promise<Preset[]> {
    return (await this.scan()).files.map((entry) => entry.preset);
  }

  /** The files the last directory scan skipped (bad YAML, schema errors, duplicate ids) and why. */
  async listInvalid(): Promise<InvalidPresetFile[]> {
    return (await this.scan()).invalid;
  }

  async get(id: string): Promise<Preset | undefined> {
    return (await this.scan()).files.find((entry) => entry.preset.id === id)?.preset;
  }

  async save(item: Preset): Promise<void> {
    await this.locks.run(`id:${item.id}`, () => this.write(item));
  }

  async update(id: string, mutator: (current: Preset) => Preset | Promise<Preset>): Promise<Preset | undefined> {
    return this.locks.run(`id:${id}`, async () => {
      const current = await this.get(id);
      if (!current) return undefined;
      const updated = await mutator(current);
      if (updated.id !== id) throw new Error('Repository update cannot change an item id');
      return this.write(updated);
    });
  }

  async delete(id: string, beforeDelete?: (current: Preset | undefined) => void | Promise<void>): Promise<void> {
    await this.locks.run(`id:${id}`, async () => {
      const found = (await this.scan()).files.find((entry) => entry.preset.id === id);
      if (beforeDelete) await beforeDelete(found?.preset);
      if (found) await rm(join(this.directory, found.file), { force: true });
    });
  }

  // Warns once per (file, reason) so repeated scans do not flood the log.
  private warn(file: string, reason: string) {
    if (this.warned.get(file) === reason) return;
    this.warned.set(file, reason);
    console.warn(`Skipping preset file ${join(this.directory, file)}: ${reason}`);
  }

  // One pass over the directory: the loadable presets and the files skipped with their reasons.
  private async scan(): Promise<{ files: PresetFile[]; invalid: InvalidPresetFile[] }> {
    await mkdir(this.directory, { recursive: true });
    const names = (await readdir(this.directory)).filter(isPresetFile).sort();
    const files: PresetFile[] = [];
    const invalid: InvalidPresetFile[] = [];
    const ids = new Map<string, string>();
    const skip = (file: string, reason: string) => {
      this.warn(file, reason);
      invalid.push({ file, reason });
    };
    for (const file of names) {
      const loaded = await this.load(file);
      // A file that vanished mid-scan is neither a preset nor invalid.
      if (!loaded) continue;
      if ('reason' in loaded) {
        skip(file, loaded.reason);
        continue;
      }
      const { preset } = loaded;
      const owner = ids.get(preset.id);
      if (owner) {
        skip(file, `duplicate preset id ${preset.id}, already used by ${owner}`);
        continue;
      }
      ids.set(preset.id, file);
      this.warned.delete(file);
      files.push({ file, preset });
    }
    return { files, invalid };
  }

  private async load(file: string): Promise<{ preset: Preset } | { reason: string } | undefined> {
    let text: string;
    try {
      text = await readFile(join(this.directory, file), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      return { reason: (error as Error).message };
    }
    let result = parsePresetYaml(text);
    if (!result.ok && result.needsStamp) {
      try {
        result = parsePresetYaml(await this.stamp(file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        return { reason: `could not stamp id: ${(error as Error).message}` };
      }
    }
    return result.ok ? { preset: result.preset } : { reason: result.reason };
  }

  // Adds a missing id and timestamps to a file that is otherwise a valid preset, keeping the user's
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

  // Writes the preset to its file, renaming it when the name changed. Returns the preset as read back
  // from the written text, so callers see exactly what is on disk. Must run inside the preset's id lock.
  private async write(preset: Preset): Promise<Preset> {
    const text = presetToYaml(preset);
    const reread = parsePresetYaml(text);
    if (!reread.ok) throw new Error(`Preset ${preset.id} cannot be stored: ${reread.reason}`);
    await this.locks.run('names', async () => {
      const existing = (await this.scan()).files.find((entry) => entry.preset.id === preset.id);
      const stem = presetFileStem(preset.name);
      let file = existing?.file;
      if (!existing || presetFileStem(existing.preset.name) !== stem) {
        const names = await readdir(this.directory);
        const taken = new Set(names.filter(isPresetFile).map(fileStem));
        file = allocatePresetFile(stem, taken);
      }
      await atomicWrite(join(this.directory, file!), text);
      if (existing && existing.file !== file) await rm(join(this.directory, existing.file), { force: true });
    });
    return reread.preset;
  }
}
