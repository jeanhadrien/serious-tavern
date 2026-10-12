import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Preset, Workflow } from '@st/shared';
import { createContext, type AppContext } from '../../context.js';
import { setImportSourcePath } from './sources.js';
import { MAX_SOURCE_FILE_BYTES, syncImportSource } from './sync.js';
import { sillyTavernConnector } from './sillytavern.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'import-sync-'));
  roots.push(root);
  const context = await createContext(join(root, 'data'), { seed: false });
  return { context, root, install: join(root, 'SillyTavern') };
}

// A minimal chat-completion file: one message prompt and an optional chat-history marker in the order.
function chatCompletion(main: string, order: string[] = ['main']) {
  return {
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', content: main },
      { identifier: 'chatHistory', name: 'Chat History', marker: true, content: null },
    ],
    prompt_order: [{ character_id: 100001, order: order.map((identifier) => ({ identifier, enabled: true })) }],
  };
}

async function writeFileAt(path: string, content: string) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
}

const settingsFile = (install: string, user: string, file: string) =>
  join(install, 'data', user, 'OpenAI Settings', file);

async function writeSettings(install: string, user: string, file: string, body: unknown) {
  await writeFileAt(settingsFile(install, user, file), typeof body === 'string' ? body : JSON.stringify(body));
}

async function connect(context: AppContext, install: string) {
  await setImportSourcePath(context, sillyTavernConnector, install);
}

const sync = (context: AppContext) => syncImportSource(context, sillyTavernConnector);
const allPresets = (context: AppContext) => context.presets.list();
// Lets timestamps differ before a rewrite.
const pause = () => new Promise((done) => setTimeout(done, 5));

describe('import sync', () => {
  it('creates one preset per settings file, suffixing users other than default-user', async () => {
    const { context, install } = await setup();
    await writeSettings(install, 'default-user', 'Alpha.json', chatCompletion('a'));
    await writeSettings(install, 'alice', 'Beta.json', chatCompletion('b'));
    // Ignored: other folders, other extensions, nested folders, and `_` users.
    await writeSettings(install, '_backup', 'Gamma.json', chatCompletion('g'));
    await writeSettings(install, 'default-user', 'notes.txt', 'not a preset');
    await writeFileAt(
      join(install, 'data', 'default-user', 'Other', 'Delta.json'),
      JSON.stringify(chatCompletion('d')),
    );
    await writeFileAt(
      join(install, 'data', 'default-user', 'OpenAI Settings', 'nested', 'Epsilon.json'),
      JSON.stringify(chatCompletion('e')),
    );
    await connect(context, install);

    expect(await sync(context)).toEqual({ created: 2, updated: 0, unchanged: 0, missing: 0 });
    const presets = await allPresets(context);
    expect(presets.map((preset) => preset.name).sort()).toEqual(['Alpha', 'Beta (alice)']);
    const beta = presets.find((preset) => preset.name === 'Beta (alice)');
    expect(beta?.source).toMatchObject({
      app: 'sillytavern',
      installPath: resolve(install),
      user: 'alice',
      file: 'Beta.json',
    });
    expect(beta?.source?.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('overwrites a changed file in place, keeping the preset id', async () => {
    const { context, install } = await setup();
    await writeSettings(install, 'default-user', 'Alpha.json', chatCompletion('first'));
    await connect(context, install);
    await sync(context);
    const [before] = await allPresets(context);
    await pause();

    await writeSettings(install, 'default-user', 'Alpha.json', chatCompletion('second'));
    expect(await sync(context)).toEqual({ created: 0, updated: 1, unchanged: 0, missing: 0 });
    const [after] = await allPresets(context);
    expect(after?.id).toBe(before?.id);
    expect(after?.entries[0]).toMatchObject({ content: 'second' });
    expect(after?.source?.hash).not.toBe(before?.source?.hash);
    expect(after?.updatedAt).not.toBe(before?.updatedAt);
  });

  it('leaves unchanged files untouched, without bumping updatedAt', async () => {
    const { context, install } = await setup();
    await writeSettings(install, 'default-user', 'Alpha.json', chatCompletion('same'));
    await connect(context, install);
    await sync(context);
    const [before] = await allPresets(context);
    await pause();

    expect(await sync(context)).toEqual({ created: 0, updated: 0, unchanged: 1, missing: 0 });
    expect((await allPresets(context))[0]).toEqual(before);
  });

  it('keeps presets whose file disappeared, marks them missing, and clears the flag when the file returns', async () => {
    const { context, install } = await setup();
    await writeSettings(install, 'default-user', 'Alpha.json', chatCompletion('kept'));
    await connect(context, install);
    await sync(context);
    const [before] = await allPresets(context);

    await rm(settingsFile(install, 'default-user', 'Alpha.json'));
    expect(await sync(context)).toEqual({ created: 0, updated: 0, unchanged: 0, missing: 1 });
    const [gone] = await allPresets(context);
    expect(gone).toMatchObject({ id: before?.id, entries: before?.entries, source: { missing: true } });
    expect(gone?.updatedAt).toBe(before?.updatedAt);

    await writeSettings(install, 'default-user', 'Alpha.json', chatCompletion('kept'));
    expect(await sync(context)).toEqual({ created: 0, updated: 0, unchanged: 1, missing: 0 });
    expect((await allPresets(context))[0]?.source?.missing).toBe(false);
  });

  it('never marks presets imported from another install folder as missing', async () => {
    const { context, install, root } = await setup();
    const elsewhere: Preset = {
      id: randomUUID(),
      name: 'Elsewhere',
      inputs: [],
      entries: [],
      createdAt: '',
      updatedAt: '',
      source: {
        app: 'sillytavern',
        installPath: join(root, 'Other'),
        user: 'default-user',
        file: 'Old.json',
        hash: 'b'.repeat(64),
        importedAt: '',
      },
    };
    await context.presets.save(elsewhere);
    await writeSettings(install, 'default-user', 'Alpha.json', chatCompletion('a'));
    await connect(context, install);

    expect(await sync(context)).toEqual({ created: 1, updated: 0, unchanged: 0, missing: 0 });
    expect((await context.presets.get(elsewhere.id))?.source?.missing).toBeUndefined();
  });

  it('skips broken and oversized files without aborting, and keeps the local copy of a file that broke', async () => {
    const { context, install } = await setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeSettings(install, 'default-user', 'Good.json', chatCompletion('good'));
    await writeSettings(install, 'default-user', 'Broken.json', '{ not json');
    await writeSettings(
      install,
      'default-user',
      'Huge.json',
      JSON.stringify(chatCompletion('x'.repeat(MAX_SOURCE_FILE_BYTES))),
    );
    await connect(context, install);

    expect(await sync(context)).toEqual({ created: 1, updated: 0, unchanged: 0, missing: 0 });
    expect((await allPresets(context)).map((preset) => preset.name)).toEqual(['Good']);
    expect(warn).toHaveBeenCalledTimes(2);

    await writeSettings(install, 'default-user', 'Good.json', '{ broke after import');
    expect(await sync(context)).toEqual({ created: 0, updated: 0, unchanged: 0, missing: 0 });
    expect((await allPresets(context))[0]?.entries[0]).toMatchObject({ content: 'good' });
  });

  it('serializes overlapping syncs so no preset is created twice', async () => {
    const { context, install } = await setup();
    await writeSettings(install, 'default-user', 'Alpha.json', chatCompletion('a'));
    await writeSettings(install, 'default-user', 'Beta.json', chatCompletion('b'));
    await connect(context, install);

    const results = await Promise.all([sync(context), sync(context)]);
    expect(results.map((result) => result.created).sort()).toEqual([0, 2]);
    expect(await allPresets(context)).toHaveLength(2);
  });

  it('drops workflow edges into preset inputs that an update removed', async () => {
    const { context, install } = await setup();
    await writeSettings(install, 'default-user', 'Alpha.json', chatCompletion('a', ['main', 'chatHistory']));
    await connect(context, install);
    await sync(context);
    const [preset] = await allPresets(context);
    const workflow: Workflow = {
      id: randomUUID(),
      name: 'Chat',
      createdAt: '',
      updatedAt: '',
      nodes: [
        { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
        { id: 'llm', type: 'llm', config: { presetId: preset?.id }, position: { x: 100, y: 0 } },
      ],
      edges: [{ id: 'history', source: 'input', sourceHandle: 'history', target: 'llm', targetHandle: 'history' }],
    };
    await context.workflows.save(workflow);

    await writeSettings(install, 'default-user', 'Alpha.json', chatCompletion('a', ['main']));
    expect(await sync(context)).toEqual({ created: 0, updated: 1, unchanged: 0, missing: 0 });
    expect((await context.workflows.get(workflow.id))?.edges).toEqual([]);
  });

  it('rejects a missing install folder and a sync with no folder configured, with 4xx codes', async () => {
    const { context, root } = await setup();
    await expect(setImportSourcePath(context, sillyTavernConnector, join(root, 'missing'))).rejects.toMatchObject({
      statusCode: 400,
      code: 'IMPORT_SOURCE_INVALID',
    });
    await expect(sync(context)).rejects.toMatchObject({ statusCode: 409, code: 'IMPORT_SOURCE_NOT_SET' });
  });
});
