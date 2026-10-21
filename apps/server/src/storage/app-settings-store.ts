import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readAppSettings, type AppSettings, type AppSettingsPatch } from '@st/shared';
import { HttpError } from '../errors.js';
import { KeyedLock } from './lock.js';
import { atomicWrite } from './repository.js';

/**
 * The app-wide preferences: one JSON file (`data/app-settings.json`). A missing file reads as the defaults and nothing is
 * written until the first update. Reads are tolerant (`readAppSettings`); a file that cannot be parsed is never
 * overwritten, so a hand edit gone wrong is not lost: reads answer the defaults with a warning, updates are refused.
 */
export class AppSettingsStore {
  private readonly lock = new KeyedLock();
  constructor(private readonly path: string) {}

  /** The stored JSON object, `undefined` when there is no file. Throws when the file is not a JSON object. */
  private async readStored(): Promise<Record<string, unknown> | undefined> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not a JSON object');
    return parsed as Record<string, unknown>;
  }

  /** The settings, with defaults for whatever the file does not say (all of them when it is missing or unreadable). */
  async get(): Promise<AppSettings> {
    try {
      return readAppSettings(await this.readStored());
    } catch (error) {
      console.warn(`Ignoring unreadable app settings ${this.path}: ${(error as Error).message}`);
      return readAppSettings(undefined);
    }
  }

  /** Merges `patch` into the file (keeping the keys it holds that this version does not know) and answers the result. */
  async update(patch: AppSettingsPatch): Promise<AppSettings> {
    return this.lock.run(this.path, async () => {
      let stored: Record<string, unknown> | undefined;
      try {
        stored = await this.readStored();
      } catch (error) {
        throw new HttpError(
          500,
          'APP_SETTINGS_UNREADABLE',
          `The app settings file ${this.path} cannot be read (${(error as Error).message}). Fix or remove it by hand.`,
        );
      }
      const merged = { ...stored, ...patch };
      await mkdir(dirname(this.path), { recursive: true });
      await atomicWrite(this.path, JSON.stringify(merged, null, 2));
      return readAppSettings(merged);
    });
  }
}
