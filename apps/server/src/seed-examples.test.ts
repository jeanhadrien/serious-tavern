import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { validateWorkflow } from '@st/engine';
import { stateDefinitionSchema, type StateDefinition } from '@st/shared';
import { createContext, type AppContext } from './context.js';
import { FOREST_COLLECTION_ID, FRESH_TEXTURE_WORKFLOW_ID, NARRATOR_PRESET_ID } from './examples/fresh-texture.js';
import {
  MEMORY_DEFINITION_ID,
  ROLLING_SUMMARIES_WORKFLOW_ID,
  SUMMARIES_NARRATOR_PRESET_ID,
  SUMMARIZE_PRESET_ID,
  SUMMARIZE_WORKFLOW_ID,
} from './examples/rolling-summaries.js';
import {
  PLOT_DEFINITION_ID,
  SCENARIST_NARRATOR_PRESET_ID,
  SCENARIST_NARRATOR_WORKFLOW_ID,
  SCENARIST_PRESET_ID,
  SCENARIST_WORKFLOW_ID,
} from './examples/scenarist.js';
import { LEDGER_FILE } from './seed-ledger.js';
import { SCENE_DEFINITION_ID } from './seed-state.js';
import { nodeResources } from './services/node-resources.js';

let directory: string;
let warn: MockInstance<typeof console.warn>;
let info: MockInstance<typeof console.log>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'seed-examples-'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  info = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  warn.mockRestore();
  info.mockRestore();
  await rm(directory, { recursive: true, force: true });
});

const open = (options: { seed?: boolean; examples?: boolean } = { seed: true, examples: true }) =>
  createContext(directory, options);
const names = async (context: AppContext) => (await context.workflows.list()).map((workflow) => workflow.name).sort();
const ledger = async () => JSON.parse(await readFile(join(directory, LEDGER_FILE), 'utf8')) as { seeded: string[] };
const issues = async (context: AppContext, id = FRESH_TEXTURE_WORKFLOW_ID) =>
  validateWorkflow((await context.workflows.get(id))!, nodeResources(context));

/** A definition the user made, with `keys` of any shape. */
const userDefinition = (name: string, keys: StateDefinition['keys'], id = crypto.randomUUID()): StateDefinition =>
  stateDefinitionSchema.parse({ id, name, keys, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });

describe('a fresh data directory', () => {
  it('gets the example next to the default records, and it validates', async () => {
    const context = await open();
    expect(await names(context)).toEqual([
      'Default Assistant',
      'Fresh texture (example)',
      'Narrator with a scenarist (example)',
      'Parallel demo',
      'Rolling summaries (example)',
      'Scenarist (example)',
      'Summarize history (example)',
    ]);
    expect((await context.collections.list()).map((item) => item.name)).toEqual(['Forest textures (example)']);
    expect((await context.presets.list()).map((item) => item.name).sort()).toEqual([
      'Default',
      'Fresh texture narrator (example)',
      'Narrator with a scenarist (example)',
      'Narrator with summaries (example)',
      'Scenarist (example)',
      'Summarize (example)',
    ]);
    expect((await context.stateDefinitions.list()).map((item) => item.id).sort()).toEqual(
      [MEMORY_DEFINITION_ID, PLOT_DEFINITION_ID, SCENE_DEFINITION_ID].sort(),
    );
    // Every seeded workflow, the defaults and the example, keeps validating.
    for (const workflow of await context.workflows.list()) expect(await issues(context, workflow.id)).toEqual([]);
    expect((await ledger()).seeded).toEqual(
      [
        `fresh-texture/collection:${FOREST_COLLECTION_ID}`,
        `fresh-texture/preset:${NARRATOR_PRESET_ID}`,
        `fresh-texture/stateDefinition:${SCENE_DEFINITION_ID}`,
        `fresh-texture/workflow:${FRESH_TEXTURE_WORKFLOW_ID}`,
        `rolling-summaries/preset:${SUMMARIES_NARRATOR_PRESET_ID}`,
        `rolling-summaries/preset:${SUMMARIZE_PRESET_ID}`,
        `rolling-summaries/stateDefinition:${MEMORY_DEFINITION_ID}`,
        `rolling-summaries/workflow:${ROLLING_SUMMARIES_WORKFLOW_ID}`,
        `rolling-summaries/workflow:${SUMMARIZE_WORKFLOW_ID}`,
        `scenarist/preset:${SCENARIST_NARRATOR_PRESET_ID}`,
        `scenarist/preset:${SCENARIST_PRESET_ID}`,
        `scenarist/stateDefinition:${PLOT_DEFINITION_ID}`,
        `scenarist/workflow:${SCENARIST_NARRATOR_WORKFLOW_ID}`,
        `scenarist/workflow:${SCENARIST_WORKFLOW_ID}`,
      ].sort(),
    );
    expect(info).toHaveBeenCalledWith('Added the example "Fresh texture (example)".');
    expect(info).toHaveBeenCalledWith('Added the example "Rolling summaries (example)".');
    expect(info).toHaveBeenCalledWith('Added the example "Scenarist with tools (example)".');
  });

  it('adds nothing unless asked to, so the other tests keep their seeds', async () => {
    const context = await open({ seed: true });
    expect(await names(context)).toEqual(['Default Assistant', 'Parallel demo']);
    await expect(readFile(join(directory, LEDGER_FILE), 'utf8')).rejects.toThrow();
  });

  it('does nothing on a restart', async () => {
    const first = await open();
    const before = {
      workflow: JSON.stringify(await first.workflows.get(FRESH_TEXTURE_WORKFLOW_ID)),
      ledger: await readFile(join(directory, LEDGER_FILE), 'utf8'),
    };
    info.mockClear();
    const again = await open();
    expect(JSON.stringify(await again.workflows.get(FRESH_TEXTURE_WORKFLOW_ID))).toBe(before.workflow);
    expect(await readFile(join(directory, LEDGER_FILE), 'utf8')).toBe(before.ledger);
    expect(await again.workflows.list()).toHaveLength(7);
    expect(await again.collections.list()).toHaveLength(1);
    expect(info).not.toHaveBeenCalled();
  });

  it('never overwrites an edited example', async () => {
    const first = await open();
    await first.workflows.update(FRESH_TEXTURE_WORKFLOW_ID, (workflow) => ({ ...workflow, name: 'My texture' }));
    await first.collections.update(FOREST_COLLECTION_ID, (item) => ({ ...item, entries: item.entries.slice(0, 2) }));
    const again = await open();
    expect((await again.workflows.get(FRESH_TEXTURE_WORKFLOW_ID))!.name).toBe('My texture');
    expect((await again.collections.get(FOREST_COLLECTION_ID))!.entries).toHaveLength(2);
    expect(await names(again)).toContain('My texture');
    expect(await names(again)).not.toContain('Fresh texture (example)');
  });

  it('does not bring a deleted example back, record by record', async () => {
    const first = await open();
    await first.workflows.delete(FRESH_TEXTURE_WORKFLOW_ID);
    await first.collections.delete(FOREST_COLLECTION_ID);
    const again = await open();
    expect(await names(again)).toEqual([
      'Default Assistant',
      'Narrator with a scenarist (example)',
      'Parallel demo',
      'Rolling summaries (example)',
      'Scenarist (example)',
      'Summarize history (example)',
    ]);
    expect(await again.collections.list()).toEqual([]);
    expect(await again.presets.get(NARRATOR_PRESET_ID)).toBeDefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('a user who already has data', () => {
  const existingUser = async () => {
    const context = await open({ seed: false });
    await context.workflows.save({
      id: 'my-workflow',
      name: 'Mine',
      nodes: [],
      edges: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    await context.stateDefinitions.save(userDefinition('inventory', { gold: { type: 'number' } }));
    return context;
  };

  it('gets the example and the scene definition it needs, next to what they have', async () => {
    await existingUser();
    const context = await open();
    expect(await names(context)).toEqual([
      'Fresh texture (example)',
      'Mine',
      'Narrator with a scenarist (example)',
      'Rolling summaries (example)',
      'Scenarist (example)',
      'Summarize history (example)',
    ]);
    expect((await context.stateDefinitions.list()).map((item) => item.name).sort()).toEqual([
      'inventory',
      'memory',
      'plot',
      'scene',
    ]);
    expect(await issues(context)).toEqual([]);
    expect(await issues(context, ROLLING_SUMMARIES_WORKFLOW_ID)).toEqual([]);
    expect(await issues(context, SUMMARIZE_WORKFLOW_ID)).toEqual([]);
    expect(await issues(context, SCENARIST_NARRATOR_WORKFLOW_ID)).toEqual([]);
    expect(await issues(context, SCENARIST_WORKFLOW_ID)).toEqual([]);
  });

  it('uses their own scene definition when it has the keys the workflow needs', async () => {
    const context = await existingUser();
    const scene = userDefinition('Scene', {
      injected: { type: 'collection', fields: { level: 'number', entryId: 'text', extra: 'text' } },
      lastInjectionLevel: { type: 'number', max: 9 },
      mood: { type: 'text' },
    });
    await context.stateDefinitions.save(scene);
    const again = await open();
    // Names are unique ignoring case: no second scene, and the workflow points at theirs.
    expect((await again.stateDefinitions.list()).map((item) => item.name).sort()).toEqual([
      'Scene',
      'inventory',
      'memory',
      'plot',
    ]);
    const workflow = (await again.workflows.get(FRESH_TEXTURE_WORKFLOW_ID))!;
    expect(
      workflow.nodes.filter((item) => item.type === 'state-write').map((item) => item.config.definitionId),
    ).toEqual([scene.id, scene.id]);
    expect(await issues(again)).toEqual([]);
  });

  it.each([
    ['has no such key', { tension: { type: 'number' } }, 'it has no key "injected"'],
    [
      'has a key of another type',
      { injected: { type: 'text' }, lastInjectionLevel: { type: 'number' } },
      'its key "injected" is a text, not a collection',
    ],
    [
      'misses a declared item field',
      { injected: { type: 'collection', fields: { level: 'number' } }, lastInjectionLevel: { type: 'number' } },
      `its key "injected" doesn't declare the same item fields`,
    ],
    [
      'has a field of another type',
      {
        injected: { type: 'collection', fields: { level: 'text', entryId: 'text' } },
        lastInjectionLevel: { type: 'number' },
      },
      `its key "injected" doesn't declare the same item fields`,
    ],
  ] as const)('skips the whole example when their scene definition %s', async (_name, keys, problem) => {
    const context = await existingUser();
    await context.stateDefinitions.save(userDefinition('scene', keys as unknown as StateDefinition['keys']));
    const again = await open();
    // The other example does not need `scene` and is added.
    expect(await names(again)).toEqual([
      'Mine',
      'Narrator with a scenarist (example)',
      'Rolling summaries (example)',
      'Scenarist (example)',
      'Summarize history (example)',
    ]);
    expect(await again.collections.list()).toEqual([]);
    expect((await again.presets.list()).map((item) => item.id)).not.toContain(NARRATOR_PRESET_ID);
    expect(warn).toHaveBeenCalledWith(
      `Example "Fresh texture (example)" not added: the state definition "scene" exists but ${problem}.`,
    );
    // Nothing was recorded, so fixing the definition lets the next start add it.
    const recorded = (await ledger()).seeded;
    expect(recorded.join()).not.toContain(FRESH_TEXTURE_WORKFLOW_ID);
    expect(recorded.join()).not.toContain(FOREST_COLLECTION_ID);
    await again.stateDefinitions.delete(
      (await again.stateDefinitions.list()).find((item) => item.name === 'scene')!.id,
    );
    expect(await names(await open())).toEqual([
      'Fresh texture (example)',
      'Mine',
      'Narrator with a scenarist (example)',
      'Rolling summaries (example)',
      'Scenarist (example)',
      'Summarize history (example)',
    ]);
  });

  it('points the scenarist at their own plot definition when it has the keys', async () => {
    const context = await existingUser();
    const plot = userDefinition('Plot', {
      tension: { type: 'number' },
      beat: { type: 'enum', options: ['calm'] },
      threads: { type: 'collection' },
      notes: { type: 'thread' },
    });
    await context.stateDefinitions.save(plot);
    const again = await open();
    const scenarist = (await again.workflows.get(SCENARIST_WORKFLOW_ID))!;
    expect(scenarist.nodes.find((item) => item.id === 'keep')?.config.definitionId).toBe(plot.id);
    expect(await issues(again, SCENARIST_WORKFLOW_ID)).toEqual([]);
  });

  it('skips the scenarist when their plot definition lacks one of its keys', async () => {
    const context = await existingUser();
    await context.stateDefinitions.save(userDefinition('plot', { tension: { type: 'number' } }));
    const again = await open();
    expect(await names(again)).not.toContain('Scenarist (example)');
    expect(await names(again)).not.toContain('Narrator with a scenarist (example)');
    expect(warn).toHaveBeenCalledWith(
      'Example "Scenarist with tools (example)" not added: the state definition "plot" exists but it has no key "beat".',
    );
  });

  it('records the scene definition they got from the old seed, so deleting it later is final', async () => {
    const first = await open({ seed: true });
    expect((await first.stateDefinitions.list()).map((item) => item.id)).toEqual([SCENE_DEFINITION_ID]);
    const context = await open();
    expect((await ledger()).seeded).toContain(`fresh-texture/stateDefinition:${SCENE_DEFINITION_ID}`);
    for (const workflow of await context.workflows.list()) await context.workflows.delete(workflow.id);
    for (const definition of await context.stateDefinitions.list())
      await context.stateDefinitions.delete(definition.id);
    for (const collection of await context.collections.list()) await context.collections.delete(collection.id);
    for (const preset of await context.presets.list()) await context.presets.delete(preset.id);
    // (The older seed of `scene` into an empty directory is off here; it is covered by its own tests.)
    const again = await open({ seed: false, examples: true });
    expect(await again.stateDefinitions.list()).toEqual([]);
    expect(await again.collections.list()).toEqual([]);
    expect(await again.workflows.list()).toEqual([]);
  });
});

describe('the ledger', () => {
  it('leaves everything alone when it is not a ledger, and does not touch the file', async () => {
    await writeFile(join(directory, LEDGER_FILE), '{ not json');
    const context = await open();
    expect(await names(context)).toEqual(['Default Assistant', 'Parallel demo']);
    expect(await readFile(join(directory, LEDGER_FILE), 'utf8')).toBe('{ not json');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('is not a seed ledger'));
    await writeFile(join(directory, LEDGER_FILE), JSON.stringify({ seeded: [1] }));
    await open();
    expect(await readFile(join(directory, LEDGER_FILE), 'utf8')).toBe(JSON.stringify({ seeded: [1] }));
  });

  it('keeps an example away from a user who deleted part of it before the workflow was added', async () => {
    // The collection was seeded and removed, but the workflow never made it: it would point at nothing.
    await writeFile(
      join(directory, LEDGER_FILE),
      JSON.stringify({ version: 1, seeded: [`collection:${FOREST_COLLECTION_ID}`] }),
    );
    const context = await open();
    expect(await names(context)).toEqual([
      'Default Assistant',
      'Narrator with a scenarist (example)',
      'Parallel demo',
      'Rolling summaries (example)',
      'Scenarist (example)',
      'Summarize history (example)',
    ]);
    expect(await context.collections.list()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a record it uses was deleted'));
  });

  it('finishes an example whose first start stopped halfway', async () => {
    const first = await open();
    // Simulate a crash before the ledger was written: the records exist, the ledger doesn't.
    await rm(join(directory, LEDGER_FILE));
    await first.workflows.delete(FRESH_TEXTURE_WORKFLOW_ID);
    const again = await open();
    expect(await names(again)).toContain('Fresh texture (example)');
    expect((await ledger()).seeded).toHaveLength(14);
  });
});
