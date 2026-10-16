import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { apiContract, errorEnvelopeSchema, type StateDefinition } from '@st/shared';
import { createApp } from './app.js';
import { StateDefinitionRepository } from './storage/state-definition-repository.js';

let directory: string;
let warn: MockInstance<typeof console.warn>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'state-definitions-test-'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  warn.mockRestore();
  await rm(directory, { recursive: true, force: true });
});

const date = '2026-01-01T00:00:00.000Z';
const stamps = () => `id: ${randomUUID()}\ncreatedAt: ${date}\nupdatedAt: ${date}\n`;
const files = join('state', 'definitions');

describe('state definition repository', () => {
  const read = (name: string) => readFile(join(directory, name), 'utf8');

  it('round-trips a record through a readable YAML file named after the definition', async () => {
    const repository = new StateDefinitionRepository(directory);
    const id = randomUUID();
    const definition = apiContract.createStateDefinition.body.parse({
      name: 'scene',
      description: 'Pacing',
      custom: 'kept',
      keys: {
        tension: { max: 10, min: 0, default: 3, type: 'number', unit: 'points' },
        mood: { options: ['calm', 'tense'], type: 'enum' },
        note: { type: 'text', default: 'line one\nline two' },
        injected: { fields: { level: 'number' }, cap: 30, type: 'collection' },
      },
    });
    await repository.save({ ...definition, id, createdAt: date, updatedAt: date } as StateDefinition);
    expect(await readdir(directory)).toEqual(['scene.yaml']);
    const text = await read('scene.yaml');
    expect(
      text.startsWith(
        'name: scene\ndescription: Pacing\nkeys:\n  tension:\n    type: number\n    default: 3\n    min: 0\n    max: 10\n    unit: points\n',
      ),
    ).toBe(true);
    expect(text).toContain('  mood:\n    type: enum\n    options:\n      - calm\n      - tense\n');
    expect(text).toContain('    default: |-\n      line one\n      line two\n');
    expect(text).toContain('  injected:\n    type: collection\n    cap: 30\n    fields:\n      level: number\n');
    expect(text.indexOf('custom: kept')).toBeLessThan(text.indexOf(`\nid: ${id}`));
    expect(text.endsWith(`id: ${id}\ncreatedAt: ${date}\nupdatedAt: ${date}\n`)).toBe(true);
    expect(await repository.get(id)).toEqual({ ...definition, id, createdAt: date, updatedAt: date });
  });

  it('reads a minimal hand-written file, stamping its id and timestamps once and keeping the user’s text', async () => {
    const body = '# my state\nname: scene\nkeys:\n  tension:\n    type: number # 0 to 10\n';
    await writeFile(join(directory, 'scene.yaml'), body);
    const repository = new StateDefinitionRepository(directory);
    const [definition] = await repository.list();
    expect(definition).toMatchObject({ name: 'scene', keys: { tension: { type: 'number' } } });
    const text = await read('scene.yaml');
    expect(text.startsWith(body)).toBe(true);
    expect(text).toContain(`id: ${definition?.id}`);
    expect(await repository.list()).toEqual([definition]);
    expect(await read('scene.yaml')).toBe(text);
  });

  it('accepts a definition without keys', async () => {
    await writeFile(join(directory, 'empty.yaml'), 'name: empty\n');
    expect(await new StateDefinitionRepository(directory).list()).toMatchObject([{ name: 'empty', keys: {} }]);
  });

  it('skips invalid files without touching them, naming the reason', async () => {
    const invalid: Record<string, [string, RegExp | string]> = {
      'broken.yaml': ['name: [unclosed\n', /^invalid YAML/],
      'type.yaml': [`name: a\nkeys:\n  x:\n    type: date\n${stamps()}`, /^invalid state definition: keys\.x\.type: /],
      'key-name.yaml': [`name: b\nkeys:\n  1x:\n    type: text\n${stamps()}`, /^invalid state definition: keys\.1x: /],
      'def-name.yaml': [`name: 9lives\nkeys: {}\n${stamps()}`, /^invalid state definition: name: /],
      'enum.yaml': [
        `name: c\nkeys:\n  x:\n    type: enum\n${stamps()}`,
        /^invalid state definition: keys\.x\.options: /,
      ],
      'range.yaml': [
        `name: d\nkeys:\n  x:\n    type: number\n    min: 5\n    max: 1\n${stamps()}`,
        /^invalid state definition: keys\.x\.max: /,
      ],
      'default.yaml': [
        `name: e\nkeys:\n  x:\n    type: number\n    max: 5\n    default: 6\n${stamps()}`,
        /^invalid state definition: keys\.x\.default: /,
      ],
      // Quote numeric options: unquoted ones are numbers, not text.
      'numeric.yaml': [
        `name: f\nkeys:\n  x:\n    type: enum\n    options: [1, 2]\n${stamps()}`,
        /^invalid state definition: keys\.x\.options\.0: /,
      ],
      'cap.yaml': [
        `name: g\nkeys:\n  x:\n    type: collection\n    cap: 0\n${stamps()}`,
        /^invalid state definition: keys\.x\.cap: /,
      ],
      'readable-id.yaml': ['name: h\nid: scene\n', /^invalid state definition: id: /],
      // Hand-written files have no id: the reason must still name the real mistake, not the id to be stamped.
      'idless-range.yaml': [
        'name: j\nkeys:\n  x:\n    type: number\n    min: 5\n    max: 1\n',
        /^invalid state definition: keys\.x\.max: /,
      ],
      'idless-default.yaml': [
        'name: k\nkeys:\n  x:\n    type: number\n    max: 5\n    default: 6\n',
        /^invalid state definition: keys\.x\.default: /,
      ],
      'idless-enum-default.yaml': [
        'name: l\nkeys:\n  x:\n    type: enum\n    options: [a, b]\n    default: c\n',
        /^invalid state definition: keys\.x\.default: /,
      ],
      // A blank `keys:` is null, which keeps a file without stamps invalid (and so never stamped).
      'null-keys.yaml': ['name: i\nkeys:\n', /^invalid state definition: keys: /],
      'list.yaml': ['- a\n- b\n', 'top level must be a mapping'],
    };
    for (const [file, [text]] of Object.entries(invalid)) await writeFile(join(directory, file), text);
    const repository = new StateDefinitionRepository(directory);
    expect(await repository.list()).toEqual([]);
    const reported = await repository.listInvalid();
    expect(reported.map((entry) => entry.file).sort()).toEqual(Object.keys(invalid).sort());
    for (const [file, [text, reason]] of Object.entries(invalid)) {
      expect(reported.find((entry) => entry.file === file)?.reason).toMatch(reason);
      expect(await read(file)).toBe(text);
    }
    expect(warn.mock.calls.every((call) => String(call[0]).startsWith('Skipping state definition file'))).toBe(true);
  });

  it('skips the second file of a duplicate id and renames the file when the name changes', async () => {
    const id = randomUUID();
    const text = `name: a\nkeys: {}\nid: ${id}\ncreatedAt: ${date}\nupdatedAt: ${date}\n`;
    await writeFile(join(directory, 'a.yaml'), text);
    await writeFile(join(directory, 'b.yaml'), text);
    const repository = new StateDefinitionRepository(directory);
    expect(await repository.list()).toHaveLength(1);
    expect((await repository.listInvalid())[0]).toMatchObject({ file: 'b.yaml' });
    await rm(join(directory, 'b.yaml'));
    await repository.update(id, (current) => ({ ...current, name: 'renamed' }));
    expect(await readdir(directory)).toEqual(['renamed.yaml']);
  });
});

describe('state definitions API', () => {
  const open = async () => createApp(directory, { seed: false });
  type App = Awaited<ReturnType<typeof open>>;
  const call = (app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload });
  const scene = { name: 'scene', description: 'Pacing', keys: { tension: { type: 'number', min: 0, max: 10 } } };
  const errorCode = (response: { json(): unknown }) => errorEnvelopeSchema.parse(response.json()).error.code;

  it('creates, lists, reads, updates and deletes a definition', async () => {
    const app = await open();
    try {
      const created = await call(app, 'POST', '/api/state-definitions', {
        ...scene,
        id: 'client-id',
        createdAt: 'client',
      });
      expect(created.statusCode).toBe(201);
      const definition = apiContract.createStateDefinition.response.parse(created.json());
      expect(definition.id).not.toBe('client-id');
      expect(definition.createdAt).not.toBe('client');
      expect(definition.keys.tension).toEqual({ type: 'number', min: 0, max: 10 });

      const list = apiContract.listStateDefinitions.response.parse(
        (await call(app, 'GET', '/api/state-definitions')).json(),
      );
      expect(list).toEqual([definition]);
      const got = await call(app, 'GET', `/api/state-definitions/${definition.id}`);
      expect(apiContract.getStateDefinition.response.parse(got.json())).toEqual(definition);

      // A field added on disk survives a PUT; a PUT without description clears it.
      const file = join(directory, files, 'scene.yaml');
      await writeFile(file, `${await readFile(file, 'utf8')}future: field\n`);
      const updated = await call(app, 'PUT', `/api/state-definitions/${definition.id}`, {
        name: 'mood',
        keys: { mood: { type: 'enum', options: ['calm'] }, tension: { type: 'text' } },
      });
      expect(updated.statusCode).toBe(200);
      const after = apiContract.updateStateDefinition.response.parse(updated.json());
      expect(after).toMatchObject({ name: 'mood', future: 'field', createdAt: definition.createdAt });
      expect(after.updatedAt).not.toBe(definition.updatedAt);
      expect(after).not.toHaveProperty('description');
      expect(Object.keys(after.keys)).toEqual(['mood', 'tension']);
      expect(await readdir(join(directory, files))).toEqual(['mood.yaml']);

      // A body echoing a whole record never writes its bookkeeping.
      const echoed = await call(app, 'PUT', `/api/state-definitions/${definition.id}`, {
        ...after,
        id: randomUUID(),
        createdAt: 'client',
      });
      expect(echoed.statusCode).toBe(200);
      expect(echoed.json()).toMatchObject({ id: definition.id, createdAt: definition.createdAt });

      expect((await call(app, 'DELETE', `/api/state-definitions/${definition.id}`)).statusCode).toBe(204);
      expect(await readdir(join(directory, files))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('answers 404 for unknown ids and 400 for ids that are not UUIDs', async () => {
    const app = await open();
    try {
      const unknown = randomUUID();
      for (const response of [
        await call(app, 'GET', `/api/state-definitions/${unknown}`),
        await call(app, 'PUT', `/api/state-definitions/${unknown}`, scene),
        await call(app, 'DELETE', `/api/state-definitions/${unknown}`),
      ]) {
        expect(response.statusCode).toBe(404);
        expect(errorCode(response)).toBe('NOT_FOUND');
      }
      for (const response of [
        await call(app, 'GET', '/api/state-definitions/scene'),
        await call(app, 'PUT', '/api/state-definitions/scene', scene),
        await call(app, 'DELETE', '/api/state-definitions/scene'),
      ]) {
        expect(response.statusCode).toBe(400);
        expect(errorCode(response)).toBe('VALIDATION_ERROR');
      }
    } finally {
      await app.close();
    }
  });

  it.each([
    ['a name that starts with a digit', { name: '1x', keys: {} }],
    ['a reserved name', { name: 'toString', keys: {} }],
    ['a name with a space', { name: 'my scene', keys: {} }],
    ['a reserved key name', { name: 'x', keys: { this: { type: 'text' } } }],
    ['an unknown key type', { name: 'x', keys: { a: { type: 'date' } } }],
    ['an enum without options', { name: 'x', keys: { a: { type: 'enum', options: [] } } }],
    ['a reversed range', { name: 'x', keys: { a: { type: 'number', min: 3, max: 1 } } }],
    // A write replaces the keys, so leaving them out must not erase them.
    ['no keys', { name: 'x' }],
  ])('rejects %s with 400 and writes nothing', async (_, payload) => {
    const app = await open();
    try {
      const response = await call(app, 'POST', '/api/state-definitions', payload);
      expect(response.statusCode).toBe(400);
      expect(errorCode(response)).toBe('VALIDATION_ERROR');
      expect((await call(app, 'GET', '/api/state-definitions')).json()).toEqual([]);

      const { id } = (await call(app, 'POST', '/api/state-definitions', scene)).json() as StateDefinition;
      const file = join(directory, files, 'scene.yaml');
      const before = await readFile(file, 'utf8');
      const put = await call(app, 'PUT', `/api/state-definitions/${id}`, payload);
      expect(put.statusCode).toBe(400);
      expect(errorCode(put)).toBe('VALIDATION_ERROR');
      expect(await readFile(file, 'utf8')).toBe(before);
    } finally {
      await app.close();
    }
  });

  it('keeps names unique, ignoring case, on create and rename', async () => {
    const app = await open();
    try {
      const first = (await call(app, 'POST', '/api/state-definitions', scene)).json() as StateDefinition;
      for (const name of ['scene', 'Scene', 'SCENE']) {
        const response = await call(app, 'POST', '/api/state-definitions', { ...scene, name });
        expect(response.statusCode).toBe(409);
        expect(errorEnvelopeSchema.parse(response.json()).error).toMatchObject({
          code: 'STATE_DEFINITION_NAME_TAKEN',
          message: `A state definition named "${name}" already exists.`,
        });
      }
      const second = (
        await call(app, 'POST', '/api/state-definitions', { ...scene, name: 'mood' })
      ).json() as StateDefinition;
      const taken = await call(app, 'PUT', `/api/state-definitions/${second.id}`, { ...scene, name: 'Scene' });
      expect(taken.statusCode).toBe(409);
      expect(errorCode(taken)).toBe('STATE_DEFINITION_NAME_TAKEN');
      // Keeping its own name, or changing only its letters' case, is fine (nothing holds data yet).
      expect(
        (await call(app, 'PUT', `/api/state-definitions/${first.id}`, { ...scene, description: 'x' })).statusCode,
      ).toBe(200);
      expect(
        (await call(app, 'PUT', `/api/state-definitions/${first.id}`, { ...scene, name: 'Scene' })).statusCode,
      ).toBe(200);
      expect((await call(app, 'GET', '/api/state-definitions')).json()).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('creates one definition when the same name is posted twice at once', async () => {
    const app = await open();
    try {
      const responses = await Promise.all([1, 2, 3].map(() => call(app, 'POST', '/api/state-definitions', scene)));
      expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409, 409]);
      expect(await readdir(join(directory, files))).toEqual(['scene.yaml']);
    } finally {
      await app.close();
    }
  });
});
