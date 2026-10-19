import { readFile } from 'node:fs/promises';
import { atomicWrite } from './storage/repository.js';

export const LEDGER_FILE = '.seeded.json';

type Log = { warn(message: string): void };

/**
 * The records ever seeded, so one that was deleted is not created again. An entry names its pack and the record:
 * `fresh-texture/workflow:<id>`. Older files hold the bare `workflow:<id>`; those still count, and are renamed
 * when their pack next sees the record, so a user can tell which lines belong to which example.
 */
export class SeedLedger {
  private readonly entries: Set<string>;
  /** True when entries were added or renamed since the file was read or written. */
  changed = false;

  constructor(entries: Iterable<string> = []) {
    this.entries = new Set(entries);
  }

  has(pack: string, record: string): boolean {
    return this.entries.has(`${pack}/${record}`) || this.entries.has(record);
  }

  add(pack: string, record: string): void {
    const named = `${pack}/${record}`;
    if (this.entries.has(named)) return;
    this.entries.delete(record);
    this.entries.add(named);
    this.changed = true;
  }

  async write(path: string): Promise<void> {
    await atomicWrite(path, JSON.stringify({ version: 1, seeded: [...this.entries].sort() }, null, 2));
    this.changed = false;
  }
}

/**
 * A missing file is an empty ledger. An unreadable one is `undefined` and is never rewritten: nothing is seeded
 * rather than guessing what was seeded (an empty ledger would bring every deleted example back).
 */
export async function readLedger(path: string, log: Log): Promise<SeedLedger | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new SeedLedger();
    log.warn(`Not seeding the examples: can't read ${path}: ${(error as Error).message}`);
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as { seeded?: unknown };
    if (Array.isArray(parsed.seeded) && parsed.seeded.every((entry) => typeof entry === 'string'))
      return new SeedLedger(parsed.seeded as string[]);
  } catch {
    // reported below
  }
  log.warn(`Not seeding the examples: ${path} is not a seed ledger. Fix or remove it by hand.`);
  return undefined;
}
