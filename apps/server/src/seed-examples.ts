import { join } from 'node:path';
import type { Collection, Preset, StateDefinition, Workflow } from '@st/shared';
import { examplePacks } from './examples/index.js';
import { LEDGER_FILE, readLedger, type SeedLedger } from './seed-ledger.js';
import type { Repository } from './storage/repository.js';

/**
 * A set of example records that belong together: a workflow, the preset and collection it uses and the state
 * definitions it reads or writes. Every record has a FIXED id.
 */
export type ExamplePack = {
  /** Names the pack's lines in the ledger (`fresh-texture/workflow:<id>`); never changes once shipped. */
  id: string;
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
  // Examples are optional: a failing pack or ledger write is logged and never stops the server from starting. The
  // ledger is written after every pack, so what was created stays recorded whatever happens to the next one.
  for (const pack of packs) {
    try {
      await seedPack(pack, stores, ledger, log);
    } catch (error) {
      log.warn(`Example "${pack.name}" not added: ${(error as Error).message}`);
    }
    if (ledger.changed)
      await ledger.write(path).catch((error: Error) => log.warn(`Could not write ${path}: ${error.message}`));
  }
}

type Item = { key: string; found: boolean; create(): Promise<void> };

/** A collection key with a cap drops its oldest items; the examples expect none. */
function capHints(ours: StateDefinition, theirs: StateDefinition, keys: string[], pack: string): string[] {
  return keys.flatMap((key) => {
    const want = ours.keys[key];
    const have = theirs.keys[key];
    if (want?.type !== 'collection' || have?.type !== 'collection' || have.cap === undefined || want.cap !== undefined)
      return [];
    return [
      `Example "${pack}": "${theirs.name}.${key}" has a cap of ${have.cap}; the example expects none, so its oldest items are dropped.`,
    ];
  });
}

async function seedPack(pack: ExamplePack, stores: ExampleStores, ledger: SeedLedger, log: Log): Promise<void> {
  const existing = await stores.stateDefinitions.list();
  const definitionIds: Record<string, string> = {};
  const items: Item[] = [];
  const hints: string[] = [];
  let blocked: string | undefined;

  for (const definition of pack.definitions()) {
    const key = `stateDefinition:${definition.id}`;
    const sameId = existing.find((candidate) => candidate.id === definition.id);
    // Names are unique ignoring case, so another definition with the name is a stand-in or a reason to skip.
    const sameName = existing.find(
      (candidate) => candidate.id !== definition.id && candidate.name.toLowerCase() === definition.name.toLowerCase(),
    );
    const present = sameId ?? sameName;
    if (present) {
      // Ours may have been edited too, so the same-id definition has to fit the workflow as well.
      const uses = pack.uses[definition.name] ?? [];
      const problem = misfit(definition, present, uses);
      if (problem) blocked ??= `the state definition "${present.name}" exists but ${problem}`;
      else hints.push(...capHints(definition, present, uses, pack.name));
    }
    definitionIds[definition.name] = present?.id ?? definition.id;
    if (sameId || !present)
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
  const all = [...items, main];

  if (blocked) {
    // Said only while there is something to create: a pack that was seeded long ago has nothing left to say.
    if (all.some((item) => !item.found && !ledger.has(pack.id, item.key)))
      log.warn(`Example "${pack.name}" not added: ${blocked}.`);
    return;
  }
  // A record seeded earlier and since deleted is not created again, so the workflow would point at nothing:
  // a pack whose workflow is still to be created is left alone then.
  const creating = !main.found && !ledger.has(pack.id, main.key);
  if (creating && items.some((item) => !item.found && ledger.has(pack.id, item.key))) {
    log.warn(`Example "${pack.name}" not added: a record it uses was deleted after it was first seeded.`);
    return;
  }
  for (const item of all) {
    // A record seeded earlier and deleted since stays deleted; its ledger line is only renamed after the pack.
    if (!item.found && !ledger.has(pack.id, item.key)) await item.create();
    ledger.add(pack.id, item.key);
  }
  if (creating) {
    for (const hint of hints) log.info(hint);
    log.info(`Added the example "${pack.name}".`);
  }
}
