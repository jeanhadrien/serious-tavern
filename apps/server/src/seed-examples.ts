import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collection, Preset, StateDefinition, Workflow } from '@st/shared';
import { examplePacks } from './examples/index.js';
import { atomicWrite, type Repository } from './storage/repository.js';

/**
 * A set of example records that belong together: a workflow, the preset and collection it uses and the state
 * definitions it reads or writes. Every record has a FIXED id.
 */
export type ExamplePack = {
  name: string;
  collections(): Collection[];
  definitions(): StateDefinition[];
  presets(): Preset[];
  /** `definitionIds` maps each of the pack's definition names to the id the workflow must use (see `seedExamples`). */
  workflow(definitionIds: Record<string, string>): Workflow;
  /** The keys of each definition (by name) the workflow reads or writes: what an existing definition must have. */
  uses: Record<string, string[]>;
};

/** Where the example records go: the repositories of the server. */
export type ExampleStores = {
  collections: Pick<Repository<Collection>, 'get' | 'save'>;
  stateDefinitions: Pick<Repository<StateDefinition>, 'list' | 'save'>;
  presets: Pick<Repository<Preset>, 'get' | 'save'>;
  workflows: Pick<Repository<Workflow>, 'get' | 'save'>;
};

type Log = { info(message: string): void; warn(message: string): void };

export const LEDGER_FILE = '.seeded.json';

/**
 * The records ever seeded (`kind:id`), so one that was deleted is not created again. A missing file is an empty
 * ledger; an unreadable one is `undefined` and is never rewritten (nothing is seeded rather than guessing).
 */
async function readLedger(path: string, log: Log): Promise<Set<string> | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    log.warn(`Not seeding the examples: can't read ${path}: ${(error as Error).message}`);
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as { seeded?: unknown };
    if (Array.isArray(parsed.seeded) && parsed.seeded.every((entry) => typeof entry === 'string'))
      return new Set(parsed.seeded as string[]);
  } catch {
    // reported below
  }
  log.warn(`Not seeding the examples: ${path} is not a seed ledger. Fix or remove it by hand.`);
  return undefined;
}

const writeLedger = (path: string, ledger: Set<string>) =>
  atomicWrite(path, JSON.stringify({ version: 1, seeded: [...ledger].sort() }, null, 2));

type Declared = Extract<StateDefinition['keys'][string], { type: 'collection' }>['fields'];
const sameFields = (ours: Declared, theirs: Declared) =>
  Object.entries(ours ?? {}).every(([name, type]) => theirs?.[name] === type);

/** Why an existing definition can't stand in for the example's one (plain words), or undefined when it can. */
function misfit(ours: StateDefinition, theirs: StateDefinition, keys: string[]): string | undefined {
  for (const key of keys) {
    const want = ours.keys[key];
    const have = theirs.keys[key];
    if (!want) continue;
    if (!have) return `it has no key "${key}"`;
    if (have.type !== want.type) return `its key "${key}" is a ${have.type}, not a ${want.type}`;
    if (want.type === 'collection' && have.type === 'collection' && !sameFields(want.fields, have.fields))
      return `its key "${key}" doesn't declare the same item fields`;
  }
  return undefined;
}

/**
 * Creates the example packs for users who already have data (the empty-store seeds only run into empty stores).
 * A record is created only when (a) no record with its id exists and (b) it was never seeded before, which a ledger
 * file (`data/.seeded.json`) remembers, so a deleted example stays deleted, an edited one is never overwritten and a
 * restart does nothing. A record found by id is added to the ledger as well. A definition whose name is taken by
 * another definition is not created; the pack uses the existing one when it has the keys the workflow needs
 * (`uses`), and is skipped, with a log line, when it doesn't. A pack is all or nothing: nothing of it is created
 * when its workflow can't be built.
 */
export async function seedExamples(
  stores: ExampleStores,
  dataDir: string,
  log: Log = { info: console.log, warn: console.warn },
  packs: readonly ExamplePack[] = examplePacks,
): Promise<void> {
  const path = join(dataDir, LEDGER_FILE);
  const ledger = await readLedger(path, log);
  if (!ledger) return;
  const before = ledger.size;
  for (const pack of packs) await seedPack(pack, stores, ledger, log);
  if (ledger.size !== before) await writeLedger(path, ledger);
}

type Item = { key: string; found: boolean; create(): Promise<void> };

async function seedPack(pack: ExamplePack, stores: ExampleStores, ledger: Set<string>, log: Log): Promise<void> {
  const existing = await stores.stateDefinitions.list();
  const definitionIds: Record<string, string> = {};
  const items: Item[] = [];

  for (const definition of pack.definitions()) {
    const key = `stateDefinition:${definition.id}`;
    const sameId = existing.find((candidate) => candidate.id === definition.id);
    // Names are unique ignoring case, so another definition with the name is a stand-in or a reason to skip.
    const sameName = existing.find(
      (candidate) => candidate.id !== definition.id && candidate.name.toLowerCase() === definition.name.toLowerCase(),
    );
    if (!sameId && sameName) {
      const problem = misfit(definition, sameName, pack.uses[definition.name] ?? []);
      if (problem) {
        log.warn(`Example "${pack.name}" not added: the state definition "${sameName.name}" exists but ${problem}.`);
        return;
      }
      definitionIds[definition.name] = sameName.id;
      continue;
    }
    definitionIds[definition.name] = definition.id;
    items.push({ key, found: !!sameId, create: () => stores.stateDefinitions.save(definition) });
  }
  for (const collection of pack.collections())
    items.push({
      key: `collection:${collection.id}`,
      found: !!(await stores.collections.get(collection.id)),
      create: () => stores.collections.save(collection),
    });
  for (const preset of pack.presets())
    items.push({
      key: `preset:${preset.id}`,
      found: !!(await stores.presets.get(preset.id)),
      create: () => stores.presets.save(preset),
    });
  const workflow = pack.workflow(definitionIds);
  const main: Item = {
    key: `workflow:${workflow.id}`,
    found: !!(await stores.workflows.get(workflow.id)),
    create: () => stores.workflows.save(workflow),
  };

  // A record seeded earlier and since deleted is not created again, so the workflow would point at nothing:
  // a pack whose workflow is still to be created is left alone then.
  const creating = !main.found && !ledger.has(main.key);
  if (creating && items.some((item) => !item.found && ledger.has(item.key))) {
    log.warn(`Example "${pack.name}" not added: a record it uses was deleted after it was first seeded.`);
    return;
  }
  for (const item of [...items, main]) {
    if (!item.found && ledger.has(item.key)) continue;
    if (!item.found) await item.create();
    ledger.add(item.key);
  }
  if (creating) log.info(`Added the example "${pack.name}".`);
}
