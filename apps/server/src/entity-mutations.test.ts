import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { apiContract } from '@st/shared';
import { createContext } from './context.js';
import { registerCharacters } from './routes/characters.js';
import { registerPersonas } from './routes/personas.js';
import { registerErrors } from './errors.js';
import * as uploads from './uploads.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const allowConcurrentRequest = () => new Promise((resolve) => setTimeout(resolve, 40));

it.each(['characters', 'personas'] as const)(
  '%s keeps concurrent edits and avatar uploads under the same entity lock',
  async (resource) => {
    const directory = join(process.cwd(), '.test-data', `entities-${randomUUID()}`);
    const context = await createContext(directory, { seed: false });
    const app = Fastify();
    app.addContentTypeParser('image/png', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    registerCharacters(app, context);
    registerPersonas(app, context);
    registerErrors(app);
    const started = deferred();
    const release = deferred();
    const storeAvatar = uploads.storeAvatar;
    const spy = vi.spyOn(uploads, 'storeAvatar').mockImplementation(async (...args) => {
      started.resolve();
      await release.promise;
      return storeAvatar(...args);
    });
    try {
      const created = await app.inject({ method: 'POST', url: `/api/${resource}`, payload: { name: 'Original' } });
      expect(created.statusCode).toBe(201);
      const { id } = created.json();
      const avatar = app
        .inject({
          method: 'PUT',
          url: `/api/${resource}/${id}/avatar`,
          headers: { 'content-type': 'image/png' },
          payload: Buffer.from('avatar bytes'),
        })
        .then((response) => response);
      await started.promise;
      const edit = app
        .inject({
          method: 'PUT',
          url: `/api/${resource}/${id}`,
          payload: { name: 'Edited', description: 'Updated' },
        })
        .then((response) => response);
      await Promise.race([edit, allowConcurrentRequest()]);
      release.resolve();
      const responses = await Promise.all([avatar, edit]);
      for (const response of responses) expect(response.statusCode).toBe(200);
      const result = await app.inject({ method: 'GET', url: `/api/${resource}/${id}` });
      const schema = resource === 'characters' ? apiContract.getCharacter.response : apiContract.getPersona.response;
      expect(schema.parse(result.json())).toMatchObject({
        name: 'Edited',
        description: 'Updated',
        avatar: `${id}.png`,
      });
      const image = await app.inject({ method: 'GET', url: `/api/${resource}/${id}/avatar` });
      expect(image.rawPayload).toEqual(Buffer.from('avatar bytes'));
    } finally {
      release.resolve();
      spy.mockRestore();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.each(
  (['characters', 'personas'] as const).flatMap((resource) =>
    (['edit', 'avatar'] as const).map((mutation) => ({ resource, mutation })),
  ),
)(
  '$resource $mutation racing delete never resurrects an entity or leaves its avatar',
  async ({ resource, mutation }) => {
    const directory = join(process.cwd(), '.test-data', `entities-${randomUUID()}`);
    const context = await createContext(directory, { seed: false });
    const app = Fastify();
    app.addContentTypeParser('image/png', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    registerCharacters(app, context);
    registerPersonas(app, context);
    registerErrors(app);
    const started = deferred();
    const release = deferred();
    try {
      const created = await app.inject({ method: 'POST', url: `/api/${resource}`, payload: { name: 'Original' } });
      const { id } = created.json();
      const repository = context[resource].silent;
      if (mutation === 'edit') {
        const get = repository.get.bind(repository);
        let paused = false;
        vi.spyOn(repository, 'get').mockImplementation(async (key) => {
          const current = await get(key);
          if (key === id && !paused) {
            paused = true;
            started.resolve();
            await release.promise;
          }
          return current;
        });
      } else {
        const storeAvatar = uploads.storeAvatar;
        vi.spyOn(uploads, 'storeAvatar').mockImplementation(async (...args) => {
          started.resolve();
          await release.promise;
          return storeAvatar(...args);
        });
      }
      const update = app
        .inject({
          method: 'PUT',
          url: `/api/${resource}/${id}${mutation === 'avatar' ? '/avatar' : ''}`,
          ...(mutation === 'avatar'
            ? { headers: { 'content-type': 'image/png' }, payload: Buffer.from('avatar bytes') }
            : { payload: { name: 'Edited' } }),
        })
        .then((response) => response);
      await started.promise;
      const deletion = app.inject({ method: 'DELETE', url: `/api/${resource}/${id}` }).then((response) => response);
      await Promise.race([deletion, allowConcurrentRequest()]);
      release.resolve();
      const responses = await Promise.all([update, deletion]);
      expect(responses[0]!.statusCode).toBe(200);
      expect(responses[1]!.statusCode).toBe(204);
      expect((await app.inject({ method: 'GET', url: `/api/${resource}/${id}` })).statusCode).toBe(404);
      const avatars = resource === 'characters' ? context.characterAvatars : context.personaAvatars;
      const files = await readdir(avatars).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      });
      expect(files.filter((name) => name.startsWith(`${id}.`))).toEqual([]);
    } finally {
      release.resolve();
      vi.restoreAllMocks();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
