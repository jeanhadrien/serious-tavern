import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerRecord } from '../test-providers.js';
import { openaiCompatible } from './openai-compatible.js';

const signal = () => new AbortController().signal;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const listModels = (options: Parameters<NonNullable<typeof openaiCompatible.listModels>>[0]) =>
  openaiCompatible.listModels!(options);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listModels (openai-compatible)', () => {
  it('GETs <baseUrl>/models and normalizes the entries', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ data: [{ id: 'a', context_length: 8000 }, { name: 'no id' }] }));
    const provider = providerRecord('local', { baseUrl: 'http://localhost:11434/v1/', secret: undefined });
    expect(await listModels({ provider, signal: signal() })).toEqual([{ id: 'a', contextLength: 8000 }]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:11434/v1/models');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('sends Bearer auth only with a key, plus the record headers but not override headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ data: [] }));
    const provider = providerRecord('p', {
      headers: { 'X-Title': 'App' },
      overrides: [{ match: '*', headers: { 'X-Override': '1' } }],
    });
    await listModels({ provider, apiKey: 'sk-secret', signal: signal() });
    await listModels({ provider, signal: signal() });
    const sent = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers);
    expect(sent).toEqual([{ Authorization: 'Bearer sk-secret', 'X-Title': 'App' }, { 'X-Title': 'App' }]);
  });

  it('accepts an empty list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ data: [] }));
    expect(await listModels({ provider: providerRecord('p'), signal: signal() })).toEqual([]);
  });

  it('names the provider in upstream errors and keeps the key out of them', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: { message: 'bad key sk-secret' } }, 401));
    const provider = providerRecord('deepseek', { name: 'My DeepSeek' });
    const error = await listModels({ provider, apiKey: 'sk-secret', signal: signal() }).catch((e: Error) => e);
    expect((error as Error).message).toBe('My DeepSeek 401: bad key [redacted]');
  });

  it('keeps the key out of network errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED https://x.test/?key=sk-secret') }),
    );
    const error = await listModels({ provider: providerRecord('p'), apiKey: 'sk-secret', signal: signal() }).catch(
      (e: Error) => e,
    );
    expect((error as Error).message).toBe(
      'p could not be reached: fetch failed (connect ECONNREFUSED https://x.test/?key=[redacted])',
    );
  });

  it('rejects bodies that are not a model list', async () => {
    const provider = providerRecord('p', { name: 'Odd' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>hi</html>'));
    await expect(listModels({ provider, signal: signal() })).rejects.toThrow(
      'Odd returned a response that is not JSON',
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ models: [] }));
    await expect(listModels({ provider, signal: signal() })).rejects.toThrow('Odd returned no model list');
  });

  it('reports the abort reason when the caller cancels', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const requestSignal = init?.signal;
          requestSignal?.addEventListener('abort', () => reject(requestSignal.reason));
        }),
    );
    const controller = new AbortController();
    const pending = listModels({ provider: providerRecord('p'), signal: controller.signal });
    controller.abort(new Error('stopped'));
    await expect(pending).rejects.toThrow('stopped');
  });
});
