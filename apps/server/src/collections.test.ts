import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { apiContract, errorEnvelopeSchema, type Collection } from '@st/shared';
import { createApp } from './app.js';
import { CollectionRepository } from './storage/collection-repository.js';

let directory: string;
let warn: MockInstance<typeof console.warn>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'collections-test-'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  warn.mockRestore();
  await rm(directory, { recursive: true, force: true });
});

const date = '2026-01-01T00:00:00.000Z';
const stamps = () => `id: ${randomUUID()}\ncreatedAt: ${date}\nupdatedAt: ${date}\n`;

describe('collection repository', () => {
  const read = (name: string) => readFile(join(directory, name), 'utf8');

  it('round-trips a record through a readable YAML file named after the collection', async () => {
    const repository = new CollectionRepository(directory);
    const id = randomUUID();
    const collection = apiContract.createCollection.body.parse({
      name: 'Northern Wastes',
      description: 'World lore',
      custom: 'kept',
      entries: [
        {
          text: 'The Salt Inn sits where\nthe old road meets the river.',
          title: 'The Salt Inn',
          keywords: ['salt inn'],
        },
        { enabled: false, weight: 2, level: 2, tags: ['forest'], text: 'resin after rain', id: 'foo', extra: { a: 1 } },
        { text: 'line one\n  \nline three' },
      ],
    });
    await repository.save({ ...collection, id, createdAt: date, updatedAt: date } as Collection);
    expect(await readdir(directory)).toEqual(['northern-wastes.yaml']);
    const text = await read('northern-wastes.yaml');
    expect(text.startsWith('name: Northern Wastes\ndescription: World lore\nentries:\n  - title: The Salt Inn\n')).toBe(
      true,
    );
    expect(text).toContain('    text: |-\n      The Salt Inn sits where\n      the old road meets the river.\n');
    expect(text).toContain('  - text: resin after rain\n    tags:\n      - forest\n    level: 2\n    weight: 2\n');
    expect(text).toContain('    enabled: false\n    id: foo\n');
    expect(text).not.toContain('weight: 1');
    expect(text).not.toContain('enabled: true');
    expect(text.indexOf('custom: kept')).toBeLessThan(text.indexOf(`\nid: ${id}`));
    expect(text.endsWith(`id: ${id}\ncreatedAt: ${date}\nupdatedAt: ${date}\n`)).toBe(true);
    expect(await repository.get(id)).toEqual({ ...collection, id, createdAt: date, updatedAt: date });
  });

  it('reads a minimal hand-written file with defaults, stamping its id and timestamps once', async () => {
    const body = '# my lore\nname: Lore\nentries:\n  - text: a\n';
    await writeFile(join(directory, 'lore.yaml'), body);
    const repository = new CollectionRepository(directory);
    const [collection] = await repository.list();
    expect(collection).toMatchObject({ name: 'Lore', entries: [{ text: 'a', weight: 1, enabled: true }] });
    expect(collection?.entries[0]).not.toHaveProperty('keywords');
    const text = await read('lore.yaml');
    expect(text.startsWith(body)).toBe(true);
    expect(text).toContain(`id: ${collection?.id}`);
    expect(await repository.list()).toEqual([collection]);
    expect(await read('lore.yaml')).toBe(text);
  });

  it('skips invalid files without touching them, naming the reason', async () => {
    const files: Record<string, string> = {
      'broken.yaml': 'name: [unclosed\n',
      'level.yaml': `name: L\nentries:\n  - text: a\n    level: 7\n${stamps()}`,
      'weight.yaml': `name: W\nentries:\n  - text: a\n    weight: -1\n${stamps()}`,
      'no-text.yaml': `name: T\nentries:\n  - title: x\n${stamps()}`,
      'null-title.yaml': `name: N\nentries:\n  - text: a\n    title:\n${stamps()}`,
      'readable-id.yaml': 'name: R\nid: lore\n',
      'list.yaml': '- a\n- b\n',
    };
    for (const [file, text] of Object.entries(files)) await writeFile(join(directory, file), text);
    const repository = new CollectionRepository(directory);
    expect(await repository.list()).toEqual([]);
    const invalid = await repository.listInvalid();
    expect(invalid.map((file) => file.file).sort()).toEqual(Object.keys(files).sort());
    const reason = (file: string) => invalid.find((entry) => entry.file === file)?.reason;
    expect(reason('level.yaml')).toMatch(/^invalid collection: entries\.0\.level: /);
    expect(reason('no-text.yaml')).toMatch(/^invalid collection: entries\.0\.text: /);
    expect(reason('readable-id.yaml')).toMatch(/^invalid collection: id: /);
    expect(reason('list.yaml')).toBe('top level must be a mapping');
    for (const [file, text] of Object.entries(files)) expect(await read(file)).toBe(text);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.every((message) => message.startsWith('Skipping collection file'))).toBe(true);
  });

  it('skips the second file of a duplicate id and renames the file when the name changes', async () => {
    const id = randomUUID();
    const text = `name: A\nentries: []\nid: ${id}\ncreatedAt: ${date}\nupdatedAt: ${date}\n`;
    await writeFile(join(directory, 'a.yaml'), text);
    await writeFile(join(directory, 'b.yaml'), text);
    const repository = new CollectionRepository(directory);
    expect(await repository.list()).toHaveLength(1);
    expect((await repository.listInvalid())[0]).toMatchObject({ file: 'b.yaml' });
    await rm(join(directory, 'b.yaml'));
    await repository.update(id, (current) => ({ ...current, name: 'Renamed' }));
    expect(await readdir(directory)).toEqual(['renamed.yaml']);
  });
});

describe('collections API', () => {
  const open = async () => createApp(directory, { seed: false });
  type App = Awaited<ReturnType<typeof open>>;
  const call = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload });
  const lore = { name: 'Northern Wastes', description: 'World lore', entries: [{ text: 'a', keywords: ['inn'] }] };
  const errorCode = (response: { json(): unknown }) => errorEnvelopeSchema.parse(response.json()).error.code;

  it('creates, lists, reads, updates and deletes a collection', async () => {
    const app = await open();
    try {
      const created = await call(app, 'POST', '/api/collections', {
        ...lore,
        id: 'client-id',
        createdAt: 'client',
        entryCount: 99,
      });
      expect(created.statusCode).toBe(201);
      const collection = apiContract.createCollection.response.parse(created.json());
      expect(collection.id).not.toBe('client-id');
      expect(collection.createdAt).not.toBe('client');
      expect(collection).not.toHaveProperty('entryCount');
      expect(collection.entries).toEqual([{ text: 'a', keywords: ['inn'], weight: 1, enabled: true }]);

      const list = apiContract.listCollections.response.parse((await call(app, 'GET', '/api/collections')).json());
      expect(list).toEqual([
        {
          id: collection.id,
          name: 'Northern Wastes',
          description: 'World lore',
          entryCount: 1,
          createdAt: collection.createdAt,
          updatedAt: collection.updatedAt,
        },
      ]);
      const got = await call(app, 'GET', `/api/collections/${collection.id}`);
      expect(apiContract.getCollection.response.parse(got.json())).toEqual(collection);

      // A field added on disk survives a PUT; a PUT without description clears it.
      const file = join(directory, 'collections', 'northern-wastes.yaml');
      await writeFile(file, `${await readFile(file, 'utf8')}future: field\n`);
      const updated = await call(app, 'PUT', `/api/collections/${collection.id}`, {
        name: 'Renamed',
        entries: [{ text: 'b' }, { text: 'c', level: 3 }],
      });
      expect(updated.statusCode).toBe(200);
      const after = apiContract.updateCollection.response.parse(updated.json());
      expect(after).toMatchObject({ name: 'Renamed', future: 'field', createdAt: collection.createdAt });
      expect(after).not.toHaveProperty('description');
      expect(after.entries.map((entry) => entry.text)).toEqual(['b', 'c']);
      expect(await readdir(join(directory, 'collections'))).toEqual(['renamed.yaml']);

      expect((await call(app, 'DELETE', `/api/collections/${collection.id}`)).statusCode).toBe(204);
      expect(await readdir(join(directory, 'collections'))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('answers 404 for unknown ids and 400 for ids that are not UUIDs', async () => {
    const app = await open();
    try {
      const unknown = randomUUID();
      for (const response of [
        await call(app, 'GET', `/api/collections/${unknown}`),
        await call(app, 'PUT', `/api/collections/${unknown}`, lore),
        await call(app, 'DELETE', `/api/collections/${unknown}`),
      ]) {
        expect(response.statusCode).toBe(404);
        expect(errorCode(response)).toBe('NOT_FOUND');
      }
      const response = await call(app, 'GET', '/api/collections/lore');
      expect(response.statusCode).toBe(400);
      expect(errorCode(response)).toBe('VALIDATION_ERROR');
    } finally {
      await app.close();
    }
  });

  it.each([
    ['a blank name', { name: ' ', entries: [] }],
    ['a level out of range', { name: 'L', entries: [{ text: 'x', level: 9 }] }],
    ['an entry without text', { name: 'L', entries: [{}] }],
    ['a negative weight', { name: 'L', entries: [{ text: 'x', weight: -1 }] }],
  ])('rejects %s with 400 and writes nothing', async (_, payload) => {
    const app = await open();
    try {
      const response = await call(app, 'POST', '/api/collections', payload);
      expect(response.statusCode).toBe(400);
      expect(errorCode(response)).toBe('VALIDATION_ERROR');
      expect((await call(app, 'GET', '/api/collections')).json()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('refuses to delete a collection that Recall or Draw nodes read, naming the workflows', async () => {
    const app = await open();
    try {
      const { id } = (await call(app, 'POST', '/api/collections', lore)).json() as Collection;
      const workflow = async (name: string, type: string) =>
        (
          await call(app, 'POST', '/api/workflows', {
            name,
            nodes: [{ id: 'n', type, position: { x: 0, y: 0 }, config: { collectionIds: ['other', id] } }],
            edges: [],
          })
        ).json() as { id: string };
      const recall = await workflow('Lore reader', 'recall');
      const draw = await workflow('Deck reader', 'draw');
      // Another node type with the same config key does not count.
      await workflow('Unrelated', 'merge');

      const refused = await call(app, 'DELETE', `/api/collections/${id}`);
      expect(refused.statusCode).toBe(409);
      const { error } = errorEnvelopeSchema.parse(refused.json());
      expect(error.code).toBe('COLLECTION_IN_USE');
      expect([...(error.details as string[])].sort()).toEqual(['Deck reader', 'Lore reader']);

      await call(app, 'DELETE', `/api/workflows/${recall.id}`);
      await call(app, 'DELETE', `/api/workflows/${draw.id}`);
      expect((await call(app, 'DELETE', `/api/collections/${id}`)).statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });
});

describe('Recall in a turn', () => {
  it('recalls an entry from a collection on disk, and fails plainly once the file is gone', async () => {
    const app = await createApp(directory, { seed: false });
    try {
      const inject = async (method: 'POST' | 'PUT', url: string, payload: object) =>
        (await app.inject({ method, url, payload })).json() as { id: string };
      const lore = await inject('POST', '/api/collections', {
        name: 'Northern Wastes',
        entries: [{ text: 'The Salt Inn sits by the river.', keywords: ['salt inn'] }, { text: 'Unrelated.' }],
      });
      const position = { x: 0, y: 0 };
      const workflow = await inject('POST', '/api/workflows', {
        name: 'Lore echo',
        nodes: [
          { id: 'input', type: 'chat-input', position, config: {} },
          { id: 'recall', type: 'recall', position, config: { collectionIds: [lore.id] } },
          { id: 'output', type: 'chat-output', position, config: {} },
        ],
        edges: [{ id: 'e', source: 'recall', sourceHandle: 'text', target: 'output', targetHandle: 'value' }],
      });
      const session = await inject('POST', '/api/sessions', { workflowId: workflow.id });
      const send = () =>
        app.inject({
          method: 'POST',
          url: `/api/sessions/${session.id}/messages`,
          payload: { content: 'I enter the salt inn' },
        });
      const sent = await send();
      expect(sent.statusCode).toBe(200);
      expect(
        apiContract.sendMessage.response.parse(sent.json()).assistantMessages.map((reply) => reply.content),
      ).toEqual(['The Salt Inn sits by the river.']);

      await rm(join(directory, 'collections', 'northern-wastes.yaml'));
      const failed = await send();
      expect(failed.statusCode).toBe(500);
      const { error } = errorEnvelopeSchema.parse(failed.json());
      expect(error.code).toBe('WORKFLOW_EXECUTION_FAILED');
      expect(error.message).toContain(`Collection ${lore.id} not found`);
    } finally {
      await app.close();
    }
  });
});
