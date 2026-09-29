import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Preset } from '@st/shared';
import { httpRequest } from './nodes/http-request/index.js';
import { llm } from './nodes/llm/index.js';
import { providers } from './providers/index.js';
import { openrouter } from './providers/openrouter.js';
import type { ExecutionContext } from './types.js';

const preset: Preset = { id: '8f1fe1a9-3480-4e52-834c-f25d90684d71', name: 'Test', createdAt: '', updatedAt: '',
  inputs: [{ name: 'Prompt', key: 'prompt', enabled: true, dataType: 'text' }],
  entries: [
    { kind: 'message', id: 'system', name: 'System', enabled: true, role: 'system',
      content: 'Hello {{trigger.message}}', placement: { mode: 'ordered' } },
    { kind: 'input', id: 'prompt', name: 'Prompt', enabled: true, inputKey: 'prompt', role: 'user' }
  ] };
const ctx = (config: Record<string, unknown>): ExecutionContext => ({
  config, inputs: { input: 'hi', prompt: 'What is up?' }, trigger: { message: 'hello', sessionId: 's' },
  history: [], secrets: { get: async () => 'test-key' }, signal: new AbortController().signal,
  resources: { presets: { get: async () => preset } }, recordRequest: () => {},
  log: () => {}, emit: () => {}
});
afterEach(() => { vi.restoreAllMocks(); providers.delete('fake'); });
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
  it('uses a fake provider, rendered preset, secretName and request log', async () => {
    const chat = vi.fn().mockResolvedValue({ text: 'reply', raw: {} });
    providers.set('fake', { id: 'fake', label: 'Fake', secretName: 'fake-key', chat });
    const get = vi.fn().mockResolvedValue('test-key');
    const request = vi.fn();
    const config = { ...llm.defaultConfig, presetId: preset.id, provider: 'fake' };
    expect((await llm.execute({ ...ctx(config), secrets: { get }, recordRequest: request })).text).toBe('reply');
    expect(get).toHaveBeenCalledWith('fake-key');
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ messages: [
      { role: 'system', content: 'Hello hello' }, { role: 'user', content: 'What is up?' }
    ] }), expect.objectContaining({ apiKey: 'test-key' }));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ provider: 'fake' }));
    await expect(llm.execute({ ...ctx(config), secrets: { get: async () => undefined } })).rejects.toThrow('Missing fake-key secret');
  });
  it('sends OpenRouter request and decodes upstream errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: 'reply' } }] }), { status: 200 }));
    const config = { ...llm.defaultConfig, presetId: preset.id, topP: 0.9 };
    expect((await llm.execute(ctx(config))).text).toBe('reply');
    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-key',
        'HTTP-Referer': expect.any(String), 'X-Title': 'Serious Tavern' }),
        body: expect.stringContaining('"top_p":0.9') }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'limited' } }), { status: 429 }));
    await expect(openrouter.chat({ model: 'test', messages: [], temperature: 0.7, maxTokens: 10 },
      { apiKey: 'test-key', signal: new AbortController().signal })).rejects.toThrow('OpenRouter 429: limited');
  });
});
