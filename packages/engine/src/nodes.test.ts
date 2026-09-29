import { describe, expect, it, vi, afterEach } from 'vitest';
import { httpRequest } from './nodes/http-request/index.js';
import { llm } from './nodes/llm/index.js';
import type { ExecutionContext } from './types.js';
const ctx = (config: Record<string, unknown>): ExecutionContext => ({
  config, inputs: { input: 'hi', prompt: 'What is up?' }, trigger: { message: 'hello', sessionId: 's' },
  history: [], secrets: { get: async () => 'test-key' }, signal: new AbortController().signal,
  log: () => {}, emit: () => {}
});
afterEach(() => vi.restoreAllMocks());
describe('integration nodes', () => {
  it('templates the HTTP request and parses JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}',
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await httpRequest.execute(ctx({ method: 'POST', url: 'https://example.com/{{trigger.message}}',
      headers: [{ key: 'x-test', value: '{{input.input}}' }], body: '{{input.input}}', responseType: 'json', timeoutMs: 1000 }));
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/hello', expect.objectContaining({
      method: 'POST', headers: { 'x-test': 'hi' }, body: 'hi'
    }));
    expect(result.body).toEqual({ ok: true });
  });
  it('sends OpenRouter completion and returns text; reports missing key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'reply' } }] }), { status: 200 }));
    const config = { ...llm.defaultConfig, includeHistory: false };
    expect((await llm.execute(ctx(config))).text).toBe('reply');
    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-key' }) }));
    await expect(llm.execute({ ...ctx(config), secrets: { get: async () => undefined } })).rejects.toThrow('Missing openrouter secret');
  });
});
