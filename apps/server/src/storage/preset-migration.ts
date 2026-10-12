import { access, mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { presetSchema, type Preset } from '@st/shared';
import type { PresetRepository } from './preset-repository.js';

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

// Never overwrites an earlier `.json.migrated`: picks the first free name.
async function markMigrated(directory: string, file: string): Promise<void> {
  const from = join(directory, file);
  let target = `${from}.migrated`;
  for (let n = 2; await exists(target); n++) target = `${from}.${n}.migrated`;
  await rename(from, target);
}

/**
 * One-way, idempotent move of `<id>.json` presets to YAML. A JSON file is renamed to `.json.migrated`
 * (never deleted or edited) only after its YAML was written and read back equal. Anything doubtful is
 * left untouched with a warning.
 */
export async function migrateJsonPresets(directory: string, repository: PresetRepository): Promise<void> {
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  if (!files.length) return;
  const knownIds = new Set((await repository.list()).map((preset) => preset.id));
  for (const file of files) {
    const path = join(directory, file);
    try {
      const parsed = presetSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
      if (!parsed.success) {
        console.warn(`Not migrating preset ${path}: ${parsed.error.issues[0]?.message ?? 'invalid preset'}`);
        continue;
      }
      const preset = parsed.data;
      if (!knownIds.has(preset.id)) {
        await repository.save(preset);
        const stored = await repository.get(preset.id);
        if (!stored || !sameContent(preset, stored)) {
          // Remove only the YAML we just wrote, so the next start retries from the intact JSON.
          await repository.delete(preset.id);
          console.warn(`Not migrating preset ${path}: the YAML copy did not verify`);
          continue;
        }
        knownIds.add(preset.id);
      }
      await markMigrated(directory, file);
    } catch (error) {
      console.warn(`Not migrating preset ${path}: ${(error as Error).message}`);
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Item = { id: string; placement?: { mode: string; entryId?: string } };

// Everything except ids must match exactly. Meaningless (UUID) entry/input ids are replaced by derived
// ones in the YAML, so they are compared by position; readable ids must survive unchanged.
function sameContent(original: Preset, stored: Preset): boolean {
  const shape = (preset: Preset) => {
    const plain = JSON.parse(JSON.stringify(preset)) as { inputs: Item[]; entries: Item[] };
    const positions = new Map(plain.entries.map((entry, index) => [entry.id, index]));
    for (const entry of plain.entries) {
      if (entry.placement?.entryId !== undefined)
        entry.placement.entryId = String(positions.get(entry.placement.entryId));
    }
    for (const item of [...plain.inputs, ...plain.entries]) delete (item as Partial<Item>).id;
    return plain;
  };
  const readableIdsKept = (['inputs', 'entries'] as const).every((key) =>
    original[key].every((item, index) => UUID.test(item.id) || stored[key][index]?.id === item.id),
  );
  return readableIdsKept && isDeepStrictEqual(shape(original), shape(stored));
}
