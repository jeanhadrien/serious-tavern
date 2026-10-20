import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ChatOptions } from '@st/engine';
import { apiContract, errorEnvelopeSchema, type ProviderView } from '@st/shared';
import { createApp } from './app.js';
import { ProviderRepository } from './storage/provider-repository.js';
import { restoreAdapter, useAdapter } from './test-support/adapter.js';

let directory: string;
let warn: MockInstance<typeof console.warn>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'providers-test-'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  restoreAdapter();
  warn.mockRestore();
  await rm(directory, { recursive: true, force: true });
});

const date = '2026-01-01T00:00:00.000Z';
const body = { name: 'My DeepSeek', baseUrl: 'https://api.deepseek.com/v1', secret: 'deepseek' };

describe('provider repository', () => {
  const read = (name: string) => readFile(join(directory, name), 'utf8');

  it('round-trips a record through a readable YAML file named after the provider', async () => {
    const repository = new ProviderRepository(directory);
    const id = randomUUID();
    await repository.save(
      apiContract.createProvider.body.parse({
        ...body,
        headers: { 'X-Test': '1' },
        messageName: null,
        extraBody: { top_k: 40, nested: { a: [1, 2] } },
        overrides: [{ match: 'deepseek/*', messageName: null, reasoningFields: ['reasoning_content'] }],
        id,
        createdAt: date,
        updatedAt: date,
        custom: 'kept',
      }) as never,
    );
    expect(await readdir(directory)).toEqual(['my-deepseek.yaml']);
    const text = await read('my-deepseek.yaml');
    expect(text.startsWith('name: My DeepSeek\nkind: openai-compatible\nbaseUrl:')).toBe(true);
    expect(text.indexOf('overrides:')).toBeLessThan(text.indexOf('\nid: '));
    const stored = await repository.get(id);
    expect(stored).toMatchObject({
      name: 'My DeepSeek',
      secret: 'deepseek',
      messageName: null,
      extraBody: { top_k: 40, nested: { a: [1, 2] } },
      overrides: [{ match: 'deepseek/*', messageName: null, reasoningFields: ['reasoning_content'] }],
      custom: 'kept',
    });
  });

  it('reads a minimal hand-written file with defaults, stamping its id and timestamps once', async () => {
    const body = '# mine\nname: Local\nbaseUrl: http://localhost:11434/v1\n';
    await writeFile(join(directory, 'local.yaml'), body);
    const repository = new ProviderRepository(directory);
    const [provider] = await repository.list();
    expect(provider).toMatchObject({
      name: 'Local',
      kind: 'openai-compatible',
      messageName: 'name',
      reasoningFields: ['reasoning', 'reasoning_content'],
      headers: {},
      extraBody: {},
      overrides: [],
    });
    expect(provider?.secret).toBeUndefined();
    const text = await read('local.yaml');
    expect(text.startsWith(body)).toBe(true);
    expect(text).toContain(`id: ${provider?.id}`);
    expect(await repository.list()).toEqual([provider]);
    expect(await read('local.yaml')).toBe(text);
  });

  it('skips invalid files, including one that claims a built-in id, without touching them', async () => {
    const files: Record<string, string> = {
      'broken.yaml': 'name: [unclosed\n',
      'no-url.yaml': `name: No URL\nid: ${randomUUID()}\ncreatedAt: ${date}\nupdatedAt: ${date}\n`,
      'bad-url.yaml': `name: Bad\nbaseUrl: ftp://x\nid: ${randomUUID()}\ncreatedAt: ${date}\nupdatedAt: ${date}\n`,
      'readable-id.yaml': 'name: Readable\nbaseUrl: https://api.example.com/v1\nid: deepseek\n',
      'reserved.yaml': `name: Impostor\nbaseUrl: https://evil.example\nid: openrouter\ncreatedAt: ${date}\nupdatedAt: ${date}\n`,
    };
    for (const [file, text] of Object.entries(files)) await writeFile(join(directory, file), text);
    const repository = new ProviderRepository(directory);
    expect(await repository.list()).toEqual([]);
    expect((await repository.listInvalid()).map((invalid) => invalid.file).sort()).toEqual(Object.keys(files).sort());
    for (const [file, text] of Object.entries(files)) expect(await read(file)).toBe(text);
    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.every((message) => message.startsWith('Skipping provider file'))).toBe(true);
  });

  it('skips the second file of a duplicate id and renames the file when the name changes', async () => {
    const id = randomUUID();
    const text = `name: A\nbaseUrl: http://a.test\nid: ${id}\ncreatedAt: ${date}\nupdatedAt: ${date}\n`;
    await writeFile(join(directory, 'a.yaml'), text);
    await writeFile(join(directory, 'b.yaml'), text);
    const repository = new ProviderRepository(directory);
    expect(await repository.list()).toHaveLength(1);
    expect((await repository.listInvalid())[0]).toMatchObject({ file: 'b.yaml' });
    await rm(join(directory, 'b.yaml'));
    await repository.update(id, (current) => ({ ...current, name: 'Renamed' }));
    expect(await readdir(directory)).toEqual(['renamed.yaml']);
  });
});

describe('providers API', () => {
  const open = async () => createApp(directory, { seed: false });
  const json = async (
    app: Awaited<ReturnType<typeof open>>,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
  ) => app.inject({ method, url, payload });

  it('lists the built-in providers first, then user providers', async () => {
    const app = await open();
    try {
      const created = (await json(app, 'POST', '/api/providers', body)).json() as ProviderView;
      const list = apiContract.listProviders.response.parse((await json(app, 'GET', '/api/providers')).json());
      expect(list.map((provider) => [provider.id, provider.builtIn])).toEqual([
        ['openrouter', true],
        ['abliteration', true],
        [created.id, false],
      ]);
      expect(list[0]).toMatchObject({
        secret: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        messageName: 'name',
        reasoningFields: ['reasoning', 'reasoning_content'],
        headers: { 'X-Title': 'Serious Tavern' },
      });
      expect((await readdir(join(directory, 'providers'))).length).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('answers 409 PROVIDER_READ_ONLY to writes on the built-in provider, but allows reading and duplicating it', async () => {
    const app = await open();
    try {
      for (const response of [
        await json(app, 'PUT', '/api/providers/openrouter', body),
        await json(app, 'DELETE', '/api/providers/openrouter'),
      ]) {
        expect(response.statusCode).toBe(409);
        expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('PROVIDER_READ_ONLY');
      }
      expect((await json(app, 'GET', '/api/providers/openrouter')).json()).toMatchObject({ builtIn: true });
      const copy = (await json(app, 'POST', '/api/providers/openrouter/duplicate')).json() as ProviderView;
      expect(copy).toMatchObject({ name: 'OpenRouter (copy)', builtIn: false, secret: 'openrouter' });
      expect(copy.id).not.toBe('openrouter');
      expect(copy.createdAt).not.toBe('1970-01-01T00:00:00.000Z');
      expect((await json(app, 'GET', `/api/providers/${copy.id}`)).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('creates, updates and deletes a record, keeping unknown fields and never storing client bookkeeping', async () => {
    const app = await open();
    try {
      const created = await json(app, 'POST', '/api/providers', { ...body, builtIn: true, id: 'openrouter' });
      expect(created.statusCode).toBe(201);
      const provider = apiContract.createProvider.response.parse(created.json());
      expect(provider).toMatchObject({ builtIn: false, kind: 'openai-compatible', messageName: 'name' });
      expect(provider.id).not.toBe('openrouter');
      const file = join(directory, 'providers', 'my-deepseek.yaml');
      await writeFile(file, `${await readFile(file, 'utf8')}future: field\n`);
      const updated = await json(app, 'PUT', `/api/providers/${provider.id}`, {
        ...provider,
        name: 'Renamed',
        secret: undefined,
        messageName: null,
        builtIn: false,
        createdAt: 'ignored',
      });
      expect(updated.statusCode).toBe(200);
      const after = updated.json();
      expect(after).toMatchObject({
        name: 'Renamed',
        messageName: null,
        future: 'field',
        createdAt: provider.createdAt,
      });
      expect(after.secret).toBeUndefined();
      expect(await readdir(join(directory, 'providers'))).toEqual(['renamed.yaml']);
      expect(await readFile(join(directory, 'providers', 'renamed.yaml'), 'utf8')).not.toContain('builtIn');
      expect((await json(app, 'DELETE', `/api/providers/${provider.id}`)).statusCode).toBe(204);
      expect((await json(app, 'GET', `/api/providers/${provider.id}`)).statusCode).toBe(404);
      expect((await json(app, 'PUT', `/api/providers/${provider.id}`, body)).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('validates input and refuses to delete a provider that a workflow uses', async () => {
    const app = await open();
    try {
      for (const payload of [
        { ...body, baseUrl: 'not a url' },
        { ...body, baseUrl: 'ftp://files.example' },
        { ...body, name: ' ' },
        { ...body, secret: 'has space' },
        { ...body, kind: 'anthropic' },
      ]) {
        const response = await json(app, 'POST', '/api/providers', payload);
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        expect(errorEnvelopeSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
      }
      const provider = (await json(app, 'POST', '/api/providers', body)).json() as ProviderView;
      const workflow = (await json(app, 'POST', '/api/workflows', { name: 'Uses provider' })).json();
      await json(app, 'PUT', `/api/workflows/${workflow.id}`, {
        name: 'Uses provider',
        nodes: [
          {
            id: 'llm',
            type: 'llm',
            config: { provider: provider.id, presetId: randomUUID() },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      });
      const refused = await json(app, 'DELETE', `/api/providers/${provider.id}`);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error).toMatchObject({ code: 'PROVIDER_IN_USE', details: ['Uses provider'] });
    } finally {
      await app.close();
    }
  });
});

describe('LLM node provider resolution', () => {
  // An app with the given secrets and a session on `input -> llm -> output`; `use` points the LLM node at a provider.
  async function chat(secrets: Record<string, string>) {
    const app = await createApp(directory, { seed: false });
    for (const [name, value] of Object.entries(secrets))
      await app.inject({ method: 'PUT', url: `/api/secrets/${name}`, payload: { value } });
    const preset = (
      await app.inject({ method: 'POST', url: '/api/presets', payload: { name: 'P', inputs: [], entries: [] } })
    ).json();
    const workflow = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'W' } })).json();
    const node = (id: string, type: string, config = {}) => ({ id, type, config, position: { x: 0, y: 0 } });
    const use = (provider: string) =>
      app.inject({
        method: 'PUT',
        url: `/api/workflows/${workflow.id}`,
        payload: {
          name: 'W',
          nodes: [
            node('input', 'chat-input'),
            node('llm', 'llm', { presetId: preset.id, provider }),
            node('output', 'chat-output'),
          ],
          edges: [{ id: 'e', source: 'llm', sourceHandle: 'text', target: 'output', targetHandle: 'value' }],
        },
      });
    await use('openrouter');
    const session = (
      await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: workflow.id } })
    ).json();
    const send = () =>
      app.inject({ method: 'POST', url: `/api/sessions/${session.id}/messages`, payload: { content: 'hi' } });
    const create = async (payload: object) =>
      (await app.inject({ method: 'POST', url: '/api/providers', payload })).json() as ProviderView;
    return { app, send, use, create };
  }
  // Replaces the network with an adapter that records what it was called with.
  const echo = () => {
    const calls: ChatOptions[] = [];
    useAdapter({
      chat: async (_request, options) => {
        calls.push(options);
        return { text: 'ok', raw: {} };
      },
    });
    return calls;
  };

  it('keeps the built-in openrouter provider working with the existing openrouter secret', async () => {
    const calls = echo();
    const { app, send } = await chat({ openrouter: 'or-key' });
    try {
      expect((await send()).statusCode).toBe(200);
      expect(calls[0]).toMatchObject({ apiKey: 'or-key', provider: { id: 'openrouter' } });
    } finally {
      await app.close();
    }
  });

  it('runs a turn against a user-defined record, handing the adapter the record and its secret', async () => {
    const calls = echo();
    const { app, send, use, create } = await chat({ deepseek: 'ds-key' });
    try {
      const provider = await create(body);
      await use(provider.id);
      expect((await send()).statusCode).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ apiKey: 'ds-key', provider: { id: provider.id, baseUrl: body.baseUrl } });
    } finally {
      await app.close();
    }
  });

  it('calls a provider without a secret with no key, and names a missing secret', async () => {
    const calls = echo();
    const { app, send, use, create } = await chat({});
    try {
      await use((await create({ name: 'Local', baseUrl: 'http://localhost:11434/v1' })).id);
      expect((await send()).statusCode).toBe(200);
      expect(calls[0]?.apiKey).toBeUndefined();
      await use((await create(body)).id);
      const missing = await send();
      expect(missing.statusCode).toBe(500);
      expect(missing.json().error.message).toContain('LLM (llm): Missing deepseek secret');
    } finally {
      await app.close();
    }
  });

  it('logs the wire exchange of a real adapter call without the secret', async () => {
    const reply = `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}

data: [DONE]

`;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(reply));
    const { app, send, use, create } = await chat({ deepseek: 'ds-secret-value' });
    try {
      const provider = await create({ ...body, extraBody: { top_k: 40 } });
      await use(provider.id);
      const result = apiContract.sendMessage.response.parse((await send()).json());
      const stored = apiContract.getExecution.response.parse(
        (await app.inject({ method: 'GET', url: `/api/executions/${result.execution!.id}` })).json(),
      );
      const sent = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
      expect(stored.nodes.llm?.wire).toMatchObject({
        url: 'https://api.deepseek.com/v1/chat/completions',
        headers: { Authorization: 'Bearer [redacted]' },
        body: sent,
        status: 200,
        response: { choices: [{ delta: { content: 'ok' } }] },
      });
      expect(sent).toMatchObject({ top_k: 40, stream: true });
      expect(stored.nodes.llm).not.toHaveProperty('request');
      const files = await readdir(join(directory, 'executions'));
      const onDisk = await Promise.all(files.map((file) => readFile(join(directory, 'executions', file), 'utf8')));
      expect(onDisk.join('')).toContain('[redacted]');
      expect(onDisk.join('')).not.toContain('ds-secret-value');
    } finally {
      fetchMock.mockRestore();
      await app.close();
    }
  });

  it('fails the node naming the provider id when it no longer exists', async () => {
    echo();
    const { app, send, use } = await chat({});
    try {
      await use('deleted-provider');
      const response = await send();
      expect(response.statusCode).toBe(500);
      expect(response.json().error).toMatchObject({
        code: 'WORKFLOW_EXECUTION_FAILED',
        message: expect.stringContaining('Unknown LLM provider: deleted-provider'),
      });
    } finally {
      await app.close();
    }
  });
});
