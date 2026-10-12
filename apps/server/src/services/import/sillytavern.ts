import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from '../../errors.js';
import type { ImportConnector, SourceFile } from './connector.js';
import { mapSillyTavernPreset } from './sillytavern-mapper.js';

const SETTINGS_FOLDER = 'OpenAI Settings';
// Presets of this user keep plain names; other users' presets get a suffix to stay distinguishable.
const DEFAULT_USER = 'default-user';

/** Imports chat-completion presets from `<install>/data/<user>/OpenAI Settings/*.json`. */
export const sillyTavernConnector: ImportConnector = {
  app: 'sillytavern',
  async detect(installPath) {
    const dataDir = join(installPath, 'data');
    if (!(await isDirectory(dataDir)))
      throw new HttpError(400, 'IMPORT_SOURCE_INVALID', `No SillyTavern data folder found at ${dataDir}`);
  },
  async scan(installPath) {
    const dataDir = join(installPath, 'data');
    const users = (await readdir(dataDir, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('_'),
    );
    const files: SourceFile[] = [];
    for (const user of users) {
      const folder = join(dataDir, user.name, SETTINGS_FOLDER);
      for (const entry of await listOrEmpty(folder)) {
        // Symlinks and nested folders are skipped rather than followed.
        if (entry.isFile() && /\.json$/i.test(entry.name))
          files.push({ user: user.name, file: entry.name, path: join(folder, entry.name) });
      }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  },
  presetName({ user, file }) {
    const base = file.replace(/\.json$/i, '');
    return user === DEFAULT_USER ? base : `${base} (${user})`;
  },
  mapContent: (json) => mapSillyTavernPreset(json),
};

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

// A user without a settings folder simply has nothing to import.
async function listOrEmpty(folder: string): Promise<Dirent[]> {
  try {
    return await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
