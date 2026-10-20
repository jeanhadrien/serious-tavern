import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { stateDefinitionSchema, type StateDefinition } from '@st/shared';
import { createContext } from './context.js';
import { FRESH_TEXTURE_WORKFLOW_ID, NARRATOR_PRESET_ID } from './examples/fresh-texture.js';
import {
  ROLLING_SUMMARIES_WORKFLOW_ID,
  SUMMARIES_NARRATOR_PRESET_ID,
  SUMMARIZE_WORKFLOW_ID,
} from './examples/rolling-summaries.js';
import { SCENARIST_NARRATOR_PRESET_ID } from './examples/scenarist.js';
import { seedExamples } from './seed-examples.js';
import { LEDGER_FILE } from './seed-ledger.js';
import { defaultPreset } from './seed.js';
import { SCENE_DEFINITION_ID } from './seed-state.js';

let directory: string;
let warn: MockInstance<typeof console.warn>;
let info: MockInstance<typeof console.log>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'seed-examples-edge-'));
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
const names = async (context: Awaited<ReturnType<typeof open>>) =>
  (await context.workflows.list()).map((workflow) => workflow.name).sort();
const ledger = async () => JSON.parse(await readFile(join(directory, LEDGER_FILE), 'utf8')) as { seeded: string[] };
const userDefinition = (name: string, keys: StateDefinition['keys'], id = crypto.randomUUID()): StateDefinition =>
  stateDefinitionSchema.parse({ id, name, keys, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });

describe("a definition with the example's own id", () => {
  const misfit = { tension: { type: 'number' as const } };

  it('is checked for fit like any other, so a user-edited scene never yields an invalid workflow', async () => {
    const context = await open({ seed: false });
    await context.stateDefinitions.save(userDefinition('scene', misfit, SCENE_DEFINITION_ID));
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
    expect(warn).toHaveBeenCalledWith(
      'Example "Fresh texture (example)" not added: the state definition "scene" exists but it has no key "injected".',
    );
  });

  it('is only complained about while the example still has records to create', async () => {
    const first = await open();
    expect(warn).not.toHaveBeenCalled();
    // Seeded long ago; the user later reshapes `scene`. Nothing would be created, so nothing is said.
    await first.stateDefinitions.update(SCENE_DEFINITION_ID, (definition) => ({ ...definition, keys: misfit }));
    await open();
    expect(warn).not.toHaveBeenCalled();
    // A pack that is missing records says so on every start until it can be added.
    await first.workflows.delete(FRESH_TEXTURE_WORKFLOW_ID);
    await first.presets.delete(NARRATOR_PRESET_ID);
    await rm(join(directory, LEDGER_FILE));
    await open();
    expect(warn).toHaveBeenCalledTimes(1);
    await open();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('a stand-in definition with a cap', () => {
  it('is used, with a hint that the cap drops the oldest summaries', async () => {
    const context = await open({ seed: false });
    const memory = userDefinition('memory', { summaries: { type: 'collection', cap: 10 } });
    await context.stateDefinitions.save(memory);
    const again = await open();
    const workflow = (await again.workflows.get(SUMMARIZE_WORKFLOW_ID))!;
    expect(workflow.nodes.find((node) => node.id === 'save')?.config.definitionId).toBe(memory.id);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"memory.summaries" has a cap of 10'));
  });
});

describe('seeding never stops the server from starting', () => {
  it('logs a pack whose save fails, keeps the others and records what was created', async () => {
    const context = await open({ seed: false });
    const stores = {
      collections: context.collections,
      stateDefinitions: context.stateDefinitions,
      presets: context.presets,
      workflows: {
        get: (id: string) => context.workflows.get(id),
        save: async (workflow: Parameters<typeof context.workflows.save>[0]) => {
          if (workflow.id === FRESH_TEXTURE_WORKFLOW_ID) throw new Error('disk is full');
          return context.workflows.save(workflow);
        },
      },
    };
    await expect(
      seedExamples(stores, directory, { info: () => {}, warn: (message) => console.warn(message) }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Example "Fresh texture (example)" not added: disk is full');
    expect(await names(context)).toEqual([
      'Narrator with a scenarist (example)',
      'Rolling summaries (example)',
      'Scenarist (example)',
      'Summarize history (example)',
    ]);
    // The records the failed pack did create are recorded, the workflow is not; the next start finishes it.
    const recorded = (await ledger()).seeded;
    expect(recorded).toContain(`fresh-texture/preset:${NARRATOR_PRESET_ID}`);
    expect(recorded).not.toContain(`fresh-texture/workflow:${FRESH_TEXTURE_WORKFLOW_ID}`);
    expect(recorded).toContain(`rolling-summaries/workflow:${ROLLING_SUMMARIES_WORKFLOW_ID}`);
    expect(await names(await open())).toEqual([
      'Fresh texture (example)',
      'Narrator with a scenarist (example)',
      'Rolling summaries (example)',
      'Scenarist (example)',
      'Summarize history (example)',
    ]);
  });
});

describe('the ledger file', () => {
  it('still reads the bare entries of older files and renames them after their pack', async () => {
    const first = await open();
    const bare = (await ledger()).seeded.map((entry) => entry.slice(entry.indexOf('/') + 1));
    await writeFile(join(directory, LEDGER_FILE), JSON.stringify({ version: 1, seeded: bare }));
    // Old shape: a deleted example is still not recreated.
    await first.workflows.delete(ROLLING_SUMMARIES_WORKFLOW_ID);
    const again = await open();
    expect(await names(again)).not.toContain('Rolling summaries (example)');
    const upgraded = (await ledger()).seeded;
    expect(upgraded.every((entry) => /^(fresh-texture|rolling-summaries|scenarist)\//.test(entry))).toBe(true);
    expect(upgraded).toHaveLength(bare.length);
  });

  it('brings every deleted example back once the file is deleted, without touching what exists', async () => {
    const first = await open();
    await first.workflows.update(FRESH_TEXTURE_WORKFLOW_ID, (workflow) => ({ ...workflow, name: 'Mine' }));
    await first.workflows.delete(ROLLING_SUMMARIES_WORKFLOW_ID);
    await first.presets.delete(SUMMARIES_NARRATOR_PRESET_ID);
    await rm(join(directory, LEDGER_FILE));
    const again = await open();
    expect(await names(again)).toEqual([
      'Default Assistant',
      'Mine',
      'Narrator with a scenarist (example)',
      'Parallel demo',
      'Rolling summaries (example)',
      'Scenarist (example)',
      'Summarize history (example)',
    ]);
    expect(await again.presets.get(SUMMARIES_NARRATOR_PRESET_ID)).toBeDefined();
  });

  it('skips an example when only some of its deleted records are let go, and says so', async () => {
    const first = await open();
    await first.workflows.delete(ROLLING_SUMMARIES_WORKFLOW_ID);
    await first.presets.delete(SUMMARIES_NARRATOR_PRESET_ID);
    const kept = (await ledger()).seeded.filter(
      (entry) => !entry.endsWith(`workflow:${ROLLING_SUMMARIES_WORKFLOW_ID}`),
    );
    await writeFile(join(directory, LEDGER_FILE), JSON.stringify({ version: 1, seeded: kept }));
    expect(await names(await open())).not.toContain('Rolling summaries (example)');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a record it uses was deleted'));
  });
});

describe('the example presets', () => {
  it('are the Default preset plus what each example adds, so a character card behaves the same', async () => {
    const context = await open();
    const contents = (entries: { kind: string; content?: string }[]) =>
      entries.filter((entry) => entry.kind === 'message').map((entry) => entry.content);
    const wanted = contents(defaultPreset().entries);
    for (const id of [NARRATOR_PRESET_ID, SUMMARIES_NARRATOR_PRESET_ID, SCENARIST_NARRATOR_PRESET_ID]) {
      const preset = (await context.presets.get(id))!;
      expect(contents(preset.entries)).toEqual(expect.arrayContaining(wanted));
    }
  });
});
