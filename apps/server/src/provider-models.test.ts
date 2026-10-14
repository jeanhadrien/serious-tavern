import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListModelsOptions } from '@st/engine';
import { apiContract, errorEnvelopeSchema, type ProviderView } from '@st/shared';
import { createApp } from './app.js';
import { restoreAdapter, useAdapter } from './test-support/adapter.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'provider-models-test-'));
});
afterEach(async () => {
  restoreAdapter();
  await rm(directory, { recursive: true, force: true });
});

const fakeChat = async () => ({ text: '', raw: {} });

/** A started app plus helpers; `calls` records what the fake adapter was asked to list. */
async function setup(
  listModels: (options: ListModelsOptions) => Promise<{ id: string }[]> = async () => [{ id: 'm1' }],
) {
  const calls: ListModelsOptions[] = [];
  useAdapter({
    chat: fakeChat,
    listModels: async (options) => {
      calls.push(options);
      return listModels(options);
    },
  });
  const app = await createApp(directory, { seed: false });
  const create = async (payload: object = {}) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/providers',
        payload: { name: 'Local', baseUrl: 'http://localhost:11434/v1', ...payload },
      })
    ).json() as ProviderView;
  const models = (id: string, query = '') => app.inject({ method: 'GET', url: `/api/providers/${id}/models${query}` });
  const setSecret = (name: string, value: string) =>
    app.inject({ method: 'PUT', url: `/api/secrets/${name}`, payload: { value } });
  return { app, calls, create, models, setSecret };
}

describe('GET /api/providers/:id/models', () => {
  it('answers the contract shape and serves the second request from the cache', async () => {
    const { app, calls, create, models } = await setup();
    try {
      const { id } = await create();
      const first = await models(id);
      expect(first.statusCode).toBe(200);
      const body = apiContract.listProviderModels.response.parse(first.json());
      expect(body.models).toEqual([{ id: 'm1' }]);
      expect(Object.keys(first.json()).sort()).toEqual(['fetchedAt', 'models']);
      expect((await models(id)).json()).toEqual(first.json());
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ provider: { id, baseUrl: 'http://localhost:11434/v1' }, apiKey: undefined });
    } finally {
      await app.close();
    }
  });

  it('bypasses the cache with refresh=true only', async () => {
    const { app, calls, create, models } = await setup();
    try {
      const { id } = await create();
      await models(id);
      await models(id, '?refresh=false');
      expect(calls).toHaveLength(1);
      await models(id, '?refresh=true');
      expect(calls).toHaveLength(2);
      expect((await models(id, '?refresh=yes')).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('shares one fetch between concurrent requests', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, calls, create, models } = await setup(async () => {
      await gate;
      return [{ id: 'slow' }];
    });
    try {
      const { id } = await create();
      const pending = Promise.all([models(id), models(id, '?refresh=true')]);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      release();
      const [a, b] = await pending;
      expect(a?.json()).toEqual(b?.json());
      expect(calls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('refetches once the provider record changes', async () => {
    const { app, calls, create, models } = await setup();
    try {
      const { id } = await create();
      await models(id);
      await app.inject({
        method: 'PUT',
        url: `/api/providers/${id}`,
        payload: { name: 'Local', baseUrl: 'http://localhost:1234/v1' },
      });
      await models(id);
      expect(calls.map((call) => call.provider.baseUrl)).toEqual([
        'http://localhost:11434/v1',
        'http://localhost:1234/v1',
      ]);
    } finally {
      await app.close();
    }
  });

  it('refetches once a secret is written or deleted, and passes the key to the adapter', async () => {
    const { app, calls, create, models, setSecret } = await setup();
    try {
      const { id } = await create({ secret: 'local' });
      await setSecret('local', 'key-1');
      await models(id);
      await models(id);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.apiKey).toBe('key-1');
      await setSecret('local', 'key-2');
      await models(id);
      expect(calls.map((call) => call.apiKey)).toEqual(['key-1', 'key-2']);
      await setSecret('unrelated', 'x');
      await models(id);
      expect(calls).toHaveLength(3);
      await app.inject({ method: 'DELETE', url: '/api/secrets/local' });
      expect((await models(id)).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('answers a client error with the usual message when the named secret is missing', async () => {
    const { app, calls, create, models } = await setup();
    try {
      const { id } = await create({ secret: 'deepseek' });
      const response = await models(id);
      expect(response.statusCode).toBe(400);
      expect(errorEnvelopeSchema.parse(response.json()).error).toEqual({
        code: 'PROVIDER_SECRET_MISSING',
        message: 'Missing deepseek secret. Add it in Settings.',
      });
      expect(calls).toHaveLength(0);
      expect((await models('openrouter')).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('turns an upstream failure into 502 with the adapter message, and does not cache it', async () => {
    let fail = true;
    const { app, calls, create, models } = await setup(async () => {
      if (fail) throw new Error('Local 500: boom');
      return [{ id: 'ok' }];
    });
    try {
      const { id } = await create();
      const response = await models(id);
      expect(response.statusCode).toBe(502);
      expect(errorEnvelopeSchema.parse(response.json()).error).toEqual({
        code: 'PROVIDER_MODELS_FAILED',
        message: 'Local 500: boom',
      });
      fail = false;
      expect((await models(id)).json().models).toEqual([{ id: 'ok' }]);
      expect(calls).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('answers 404 for an unknown provider', async () => {
    const { app, models } = await setup();
    try {
      expect((await models('nope')).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('answers 501 when the adapter cannot list models', async () => {
    useAdapter({ chat: fakeChat });
    const app = await createApp(directory, { seed: false });
    try {
      const created = (
        await app.inject({
          method: 'POST',
          url: '/api/providers',
          payload: { name: 'L', baseUrl: 'http://localhost:1/v1' },
        })
      ).json() as ProviderView;
      const response = await app.inject({ method: 'GET', url: `/api/providers/${created.id}/models` });
      expect(response.statusCode).toBe(501);
      expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('PROVIDER_MODELS_UNSUPPORTED');
    } finally {
      await app.close();
    }
  });
});
