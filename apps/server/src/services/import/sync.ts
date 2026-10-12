import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { presetSchema, type ImportSyncResult, type Preset, type PresetSource } from '@st/shared';
import { now, type AppContext } from '../../context.js';
import { errorMessage, HttpError } from '../../errors.js';
import { pruneWorkflowsUsingPreset } from '../presets.js';
import type { ImportConnector, SourceFile } from './connector.js';

// Larger files count as broken: they are skipped without being read into memory.
export const MAX_SOURCE_FILE_BYTES = 5 * 1024 * 1024;

type Outcome = 'created' | 'updated' | 'unchanged' | 'skipped';

/**
 * Brings the presets of one connector in line with its install folder. Calls are serialized per
 * connector. New files create presets, changed files overwrite their preset in place, and presets
 * whose file is gone are kept and marked missing. A broken file is skipped and its local copy stays.
 */
export async function syncImportSource(context: AppContext, connector: ImportConnector): Promise<ImportSyncResult> {
  return context.importLock.run(connector.app, async () => {
    const { presets, importSources } = context;
    const source = await importSources.get(connector.app);
    if (!source) throw new HttpError(409, 'IMPORT_SOURCE_NOT_SET', `No ${connector.app} folder is configured`);
    await connector.detect(source.path);
    const files = await connector.scan(source.path);

    // Only presets imported from this install are ours to create, update or mark missing.
    const local = new Map<string, Preset>();
    for (const preset of await presets.list()) {
      if (preset.source?.app === connector.app && preset.source.installPath === source.path)
        local.set(identityOf(preset.source), preset);
    }

    const counts = { created: 0, updated: 0, unchanged: 0, missing: 0 };
    const present = new Set<string>();
    for (const file of files) {
      const key = identityOf(file);
      present.add(key);
      const outcome = await importFile(context, connector, source.path, file, local.get(key));
      if (outcome !== 'skipped') counts[outcome] += 1;
    }
    for (const [key, preset] of local) {
      if (present.has(key)) continue;
      counts.missing += 1;
      if (!preset.source?.missing) await setMissing(context, preset.id, true);
    }

    await importSources.update(connector.app, (old) => ({ ...old, lastSyncAt: now() }));
    return counts;
  });
}

/** Creates or updates the preset for one source file. Unreadable or invalid files are skipped. */
async function importFile(
  context: AppContext,
  connector: ImportConnector,
  installPath: string,
  file: SourceFile,
  existing: Preset | undefined,
): Promise<Outcome> {
  let data: Buffer;
  try {
    data = await readSourceFile(file.path);
  } catch (error) {
    return skip(file.path, error);
  }
  const hash = createHash('sha256').update(data).digest('hex');
  if (existing?.source?.hash === hash) {
    if (existing.source.missing) await setMissing(context, existing.id, false);
    return 'unchanged';
  }

  const date = now();
  const source: PresetSource = {
    app: connector.app,
    installPath,
    user: file.user,
    file: file.file,
    hash,
    importedAt: date,
  };
  try {
    const fields = connector.mapContent(JSON.parse(data.toString('utf8')));
    const name = connector.presetName(file);
    if (!existing) {
      await context.presets.save(
        presetSchema.parse({ ...fields, id: randomUUID(), name, source, createdAt: date, updatedAt: date }),
      );
      return 'created';
    }
    const updated = await context.presets.update(existing.id, (old) =>
      presetSchema.parse({ ...old, ...fields, name, source, updatedAt: date }),
    );
    if (!updated) return 'skipped';
    await pruneWorkflowsUsingPreset(context, existing.id);
    return 'updated';
  } catch (error) {
    return skip(file.path, error);
  }
}

// Clearing the flag does not bump updatedAt: only content changes count as edits.
async function setMissing(context: AppContext, id: string, missing: boolean): Promise<void> {
  await context.presets.update(id, (old) =>
    old.source ? presetSchema.parse({ ...old, source: { ...old.source, missing } }) : old,
  );
}

async function readSourceFile(path: string): Promise<Buffer> {
  const { size } = await stat(path);
  if (size > MAX_SOURCE_FILE_BYTES) throw new Error(`file is larger than ${MAX_SOURCE_FILE_BYTES} bytes`);
  return readFile(path);
}

function skip(path: string, error: unknown): 'skipped' {
  console.warn(`Skipping ${path}: ${errorMessage(error)}`);
  return 'skipped';
}

function identityOf({ user, file }: { user: string; file: string }): string {
  return `${user}/${file}`;
}
