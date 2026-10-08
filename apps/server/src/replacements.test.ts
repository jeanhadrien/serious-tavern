import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { apiContract, errorEnvelopeSchema, type Preset, type Workflow } from '@st/shared';
import { createContext } from './context.js';
import { registerWorkflows } from './routes/workflows.js';
import { registerPresets } from './routes/presets.js';
import { registerErrors } from './errors.js';
import type { Repository } from './storage/repository.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function setup() {
  const directory = join(process.cwd(), '.test-data', `replacements-${randomUUID()}`);
  const context = await createContext(directory, { seed: false });
  const app = Fastify();
  registerWorkflows(app, context);
  registerPresets(app, context);
  registerErrors(app);
  return {
    app,
    context,
    async cleanup() {
      vi.restoreAllMocks();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const replacement = { name: 'Replaced', nodes: [], edges: [], inputs: [], entries: [] };

it.each(['workflows', 'presets'] as const)(
  '%s PUT on an unknown id returns the standard 404 envelope',
  async (resource) => {
    const { app, cleanup } = await setup();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/${resource}/${randomUUID()}`,
        payload: replacement,
      });
      expect(response.statusCode).toBe(404);
      expect(errorEnvelopeSchema.parse(response.json())).toEqual({
        error: { code: 'NOT_FOUND', message: resource === 'workflows' ? 'Workflow not found' : 'Preset not found' },
      });
      expect((await app.inject({ method: 'GET', url: `/api/${resource}` })).json()).toEqual([]);
    } finally {
      await cleanup();
    }
  },
);

it.each(
  (['workflows', 'presets'] as const).flatMap((resource) =>
    (['put-first', 'delete-first'] as const).map((order) => ({ resource, order })),
  ),
)('$resource PUT racing DELETE ($order) cannot resurrect the record', async ({ resource, order }) => {
  const { app, context, cleanup } = await setup();
  const started = deferred();
  const competing = deferred();
  const release = deferred();
  try {
    const created = await app.inject({
      method: 'POST',
      url: `/api/${resource}`,
      payload: { ...replacement, name: 'Original' },
    });
    expect(created.statusCode).toBe(201);
    const { id, createdAt } = created.json();
    const repository: Repository<Workflow | Preset> = context[resource];
    const update = repository.update.bind(repository);
    const remove = repository.delete.bind(repository);
    const updateSpy = vi.spyOn(repository, 'update').mockImplementation((...args) => {
      if (order === 'delete-first') competing.resolve();
      return update(...args);
    });
    vi.spyOn(repository, 'delete').mockImplementation((key) => {
      if (order === 'put-first') {
        competing.resolve();
        return remove(key);
      }
      return remove(key, async () => {
        started.resolve();
        await release.promise;
      });
    });
    if (order === 'put-first') {
      const get = repository.get.bind(repository);
      // Workflows read once for requireEntity (prune input) and once inside update; presets read only inside update.
      const pauseAt = resource === 'workflows' ? 2 : 1;
      let calls = 0;
      let paused = false;
      vi.spyOn(repository, 'get').mockImplementation(async (key) => {
        const current = await get(key);
        calls++;
        if (key === id && calls === pauseAt && !paused) {
          paused = true;
          started.resolve();
          await release.promise;
        }
        return current;
      });
    }
    const put = () =>
      app.inject({ method: 'PUT', url: `/api/${resource}/${id}`, payload: replacement }).then((response) => response);
    const del = () => app.inject({ method: 'DELETE', url: `/api/${resource}/${id}` }).then((response) => response);
    const first = order === 'put-first' ? put() : del();
    await started.promise;
    if (order === 'put-first') expect(updateSpy).toHaveBeenCalledTimes(1);
    const second = order === 'put-first' ? del() : put();
    await competing.promise;
    release.resolve();
    const [a, b] = await Promise.all([first, second]);
    const putResponse = order === 'put-first' ? a : b;
    const deleteResponse = order === 'put-first' ? b : a;
    expect(deleteResponse.statusCode).toBe(204);
    if (order === 'put-first') {
      expect(putResponse.statusCode).toBe(200);
      const schema = resource === 'workflows' ? apiContract.updateWorkflow.response : apiContract.updatePreset.response;
      expect(schema.parse(putResponse.json())).toMatchObject({ id, createdAt, name: 'Replaced' });
    } else {
      expect(putResponse.statusCode).toBe(404);
      expect(errorEnvelopeSchema.parse(putResponse.json()).error.code).toBe('NOT_FOUND');
    }
    expect(await repository.get(id)).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: `/api/${resource}/${id}` })).statusCode).toBe(404);
  } finally {
    release.resolve();
    await cleanup();
  }
});
