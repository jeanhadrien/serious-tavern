import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Preset, PromptMessage } from '@st/shared';
import { httpRequest } from './nodes/http-request/index.js';
import { character } from './nodes/character/index.js';
import { llm, mergeSystemMessages } from './nodes/llm/index.js';
import { openaiCompatible } from './providers/openai-compatible.js';
import { openrouterProvider, providerRecord, providerResources, restoreAdapter, useAdapter } from './test-providers.js';
import type { EngineEvent, ExecutionContext } from './types.js';

const preset: Preset = {
  id: '8f1fe1a9-3480-4e52-834c-f25d90684d71',
  name: 'Test',
  createdAt: '',
  updatedAt: '',
  inputs: [{ id: 'prompt-input', key: 'prompt', dataType: 'text' }],
  entries: [
    {
      kind: 'message',
      id: 'system',
      displayName: 'System',
      enabled: true,
      role: 'system',
      content: 'Hello {{trigger.message}}',
      placement: { mode: 'ordered' },
    },
    { kind: 'slot', id: 'prompt-slot', displayName: 'Prompt', enabled: true, inputKey: 'prompt', role: 'user' },
  ],
};
const ctx = (config: Record<string, unknown>): ExecutionContext => ({
  nodeId: 'node',
  config,
  inputs: { input: 'hi', prompt: 'What is up?' },
  trigger: { message: 'hello', sessionId: 's' },
  history: [],
  secrets: { get: async () => 'test-key' },
  signal: new AbortController().signal,
  resources: { presets: { get: async () => preset }, providers: providerResources(providerRecord('fake')) },
  recordWire: () => {},
  log: () => {},
  random: () => 0.5,
  emit: () => {},
});
afterEach(() => {
  vi.restoreAllMocks();
  restoreAdapter();
});
describe('integration nodes', () => {
  it('fails clearly when a directly executed character card is missing', async () => {
    await expect(character.execute(ctx({ source: 'card', characterId: 'missing' }))).rejects.toThrow(
      'Character missing not found',
    );
  });
  it('rejects a preset input that conflicts with the dedicated character port', async () => {
    await expect(
      llm.resolvePorts?.(
        { presetId: preset.id },
        {
          presets: {
            get: async () => ({ ...preset, inputs: [{ id: 'character', key: 'character', dataType: 'text' }] }),
          },
        },
      ),
    ).rejects.toThrow('conflicts with the LLM character port');
  });
  it('resolves LLM input ports from preset inputs', async () => {
    const result = await llm.resolvePorts?.({ presetId: preset.id }, { presets: { get: async () => preset } });
    expect(result?.inputs).toEqual([
      { name: 'character', label: 'Character', dataType: 'character' },
      { name: 'prompt', label: 'Prompt', dataType: 'text', description: undefined },
    ]);
  });
  it('templates the HTTP request and parses JSON', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await httpRequest.execute(
      ctx({
        method: 'POST',
        url: 'https://example.com/{{trigger.message}}',
        headers: [{ key: 'x-test', value: '{{input.input}}' }],
        body: '{{input.input}}',
        responseType: 'json',
        timeoutMs: 1000,
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/hello',
      expect.objectContaining({
        method: 'POST',
        headers: { 'x-test': 'hi' },
        body: 'hi',
      }),
    );
    expect(result.body).toEqual({ ok: true });
  });
  it('uses a fake provider, rendered preset, secretName and wire recorder', async () => {
    const chat = vi.fn().mockResolvedValue({ text: 'reply', raw: {} });
    useAdapter({ chat });
    const get = vi.fn().mockResolvedValue('test-key');
    const recordWire = vi.fn();
    const config = { ...llm.defaultConfig, presetId: preset.id, provider: 'fake' };
    expect((await llm.execute({ ...ctx(config), secrets: { get }, recordWire })).text).toBe('reply');
    expect(get).toHaveBeenCalledWith('fake-key');
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'Hello hello' },
          { role: 'user', content: 'What is up?' },
        ],
      }),
      // The adapter reports the wire exchange straight into the execution log.
      expect.objectContaining({ apiKey: 'test-key', onWire: recordWire }),
    );
    await expect(llm.execute({ ...ctx(config), secrets: { get: async () => undefined } })).rejects.toThrow(
      'Missing fake-key secret',
    );
  });
  it('hands the resolved provider record to the adapter', async () => {
    const chat = vi.fn().mockResolvedValue({ text: 'reply', raw: {} });
    useAdapter({ chat });
    await llm.execute(ctx({ ...llm.defaultConfig, presetId: preset.id, provider: 'fake' }));
    expect(chat.mock.calls[0]?.[1]).toMatchObject({ provider: providerRecord('fake') });
  });
  it('names the provider id when it cannot be resolved', async () => {
    await expect(llm.execute(ctx({ ...llm.defaultConfig, presetId: preset.id, provider: 'nope' }))).rejects.toThrow(
      'Unknown LLM provider: nope',
    );
  });
  it('calls a provider without a secret without asking for credentials', async () => {
    const chat = vi.fn().mockResolvedValue({ text: 'reply', raw: {} });
    useAdapter({ chat });
    const get = vi.fn();
    const local = { ...providerRecord('local'), secret: undefined };
    await llm.execute({
      ...ctx({ ...llm.defaultConfig, presetId: preset.id, provider: 'local' }),
      secrets: { get },
      resources: { presets: { get: async () => preset }, providers: providerResources(local) },
    });
    expect(get).not.toHaveBeenCalled();
    expect(chat.mock.calls[0]?.[1].apiKey).toBeUndefined();
  });
  it('sends OpenRouter request and decodes upstream errors', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('data: {"choices":[{"delta":{"content":"reply"}}]}\n\ndata: [DONE]\n\n', { status: 200 }),
      );
    const config = { ...llm.defaultConfig, presetId: preset.id, topP: 0.9 };
    expect((await llm.execute(ctx(config))).text).toBe('reply');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'HTTP-Referer': expect.any(String),
          'X-Title': 'Serious Tavern',
        }),
        body: expect.stringContaining('"top_p":0.9'),
      }),
    );
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'limited' } }), { status: 429 }));
    await expect(
      openaiCompatible.chat(
        { model: 'test', messages: [], temperature: 0.7, maxTokens: 10 },
        { provider: openrouterProvider, apiKey: 'test-key', signal: new AbortController().signal },
      ),
    ).rejects.toThrow('OpenRouter 429: limited');
  });

  it('includes message names in the OpenRouter body only when present', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'reply' } }] }), { status: 200 }),
      );
    await openaiCompatible.chat(
      {
        model: 'test',
        temperature: 0.7,
        maxTokens: 10,
        messages: [
          { role: 'user', content: 'Hi', name: 'Alex' },
          { role: 'assistant', content: 'Hello' },
          { role: 'system', content: 'Empty name is still set', name: '' },
        ],
      },
      { provider: openrouterProvider, apiKey: 'test-key', signal: new AbortController().signal },
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages).toEqual([
      { role: 'user', content: 'Hi', name: 'Alex' },
      { role: 'assistant', content: 'Hello' },
      { role: 'system', content: 'Empty name is still set', name: '' },
    ]);
    expect(Object.hasOwn(body.messages[1], 'name')).toBe(false);
  });

  it('defaults system-message merging and streaming to true in the schema and node defaults', () => {
    expect(llm.defaultConfig.mergeSystemMessages).toBe(false);
    expect(llm.defaultConfig.streaming).toBe(true);
    expect(llm.configSchema.parse({ presetId: preset.id })).toMatchObject({
      mergeSystemMessages: false,
      streaming: true,
    });
  });

  it('merges only consecutive unnamed system messages without mutating the source', () => {
    const messages: PromptMessage[] = [
      { role: 'system', content: 'One' },
      { role: 'system', content: 'Two' },
      { role: 'system', content: 'Three' },
      { role: 'user', content: 'User', name: 'Alex' },
      { role: 'system', content: 'Four' },
      { role: 'system', content: 'Named', name: 'Narrator' },
      { role: 'system', content: 'Five' },
      { role: 'system', content: 'Six' },
      { role: 'assistant', content: 'Assistant' },
      { role: 'system', content: 'Seven' },
      { role: 'system', content: 'Explicit name', name: '' },
      { role: 'system', content: 'Eight' },
    ];
    const snapshot = structuredClone(messages);
    messages.forEach(Object.freeze);
    Object.freeze(messages);
    expect(mergeSystemMessages(messages)).toEqual([
      { role: 'system', content: 'One\n\nTwo\n\nThree' },
      messages[3],
      messages[4],
      messages[5],
      { role: 'system', content: 'Five\n\nSix' },
      ...messages.slice(8),
    ]);
    expect(messages).toEqual(snapshot);
    expect(mergeSystemMessages([])).toEqual([]);
  });

  it.each([undefined, false, true])('records and sends the final prompt with mergeSystemMessages=%s', async (merge) => {
    const chat = vi.fn().mockResolvedValue({ text: 'reply', raw: {} });
    useAdapter({ chat });
    const definition: Preset = {
      ...preset,
      inputs: [{ id: 'history', key: 'history', dataType: 'messages' }],
      entries: [
        preset.entries[0]!,
        {
          kind: 'message',
          id: 'empty',
          displayName: 'Empty',
          enabled: true,
          role: 'system',
          content: '{{character.scenario}}',
          placement: { mode: 'ordered' },
        },
        {
          kind: 'message',
          id: 'second',
          displayName: 'Second',
          enabled: true,
          role: 'system',
          content: 'Second',
          placement: { mode: 'ordered' },
        },
        { kind: 'slot', id: 'history', displayName: 'History', enabled: true, inputKey: 'history', role: 'user' },
      ],
    };
    const history: PromptMessage[] = [
      { role: 'system', content: 'History system' },
      { role: 'system', content: 'Named system', name: 'Narrator' },
      { role: 'user', content: 'Hi', name: 'Alex' },
    ];
    await llm.execute({
      ...ctx({ ...llm.defaultConfig, presetId: preset.id, provider: 'fake', mergeSystemMessages: merge }),
      inputs: { history },
      resources: { presets: { get: async () => definition }, providers: providerResources(providerRecord('fake')) },
    });
    const expected = merge
      ? [{ role: 'system', content: 'Hello hello\n\nSecond\n\nHistory system' }, ...history.slice(1)]
      : [{ role: 'system', content: 'Hello hello' }, { role: 'system', content: 'Second' }, ...history];
    expect(chat.mock.calls[0]?.[0].messages).toEqual(expected);
    expect(history[0]?.content).toBe('History system');
  });

  it('emits a delta per streamed chunk, then returns the accumulated reply unchanged', async () => {
    const chat = vi.fn();
    const stream = vi.fn(async (_request, { onToken, onReasoning }) => {
      onReasoning('Plan.');
      onToken('Hel');
      onToken('lo');
      return { text: 'Hello', raw: { streamed: true } };
    });
    useAdapter({ chat, stream });
    const events: EngineEvent[] = [];
    const result = await llm.execute({
      ...ctx({ ...llm.defaultConfig, presetId: preset.id, provider: 'fake' }),
      nodeId: 'llm-node',
      emit: (event) => events.push(event),
    });
    expect(result).toEqual({ text: 'Hello', raw: { streamed: true } });
    expect(chat).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'node:delta', nodeId: 'llm-node', detail: { reasoningDelta: 'Plan.' } },
      { type: 'node:delta', nodeId: 'llm-node', detail: { textDelta: 'Hel' } },
      { type: 'node:delta', nodeId: 'llm-node', detail: { textDelta: 'lo' } },
    ]);
  });

  it('falls back to chat without deltas when the provider cannot stream', async () => {
    const chat = vi.fn().mockResolvedValue({ text: 'whole', raw: { whole: true } });
    useAdapter({ chat });
    const emit = vi.fn();
    const result = await llm.execute({
      ...ctx({ ...llm.defaultConfig, presetId: preset.id, provider: 'fake' }),
      emit,
    });
    expect(result).toEqual({ text: 'whole', raw: { whole: true } });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });

  it('uses chat without deltas when streaming is disabled, even if the provider supports it', async () => {
    const chat = vi.fn().mockResolvedValue({ text: 'whole', raw: { whole: true } });
    const stream = vi.fn();
    useAdapter({ chat, stream });
    const emit = vi.fn();
    const result = await llm.execute({
      ...ctx({ ...llm.defaultConfig, presetId: preset.id, provider: 'fake', streaming: false }),
      emit,
    });
    expect(result).toEqual({ text: 'whole', raw: { whole: true } });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('surfaces a non-streamed reasoning trace as one reasoning delta', async () => {
    useAdapter({ chat: vi.fn().mockResolvedValue({ text: 'whole', reasoning: 'Plan.', raw: {} }) });
    const events: EngineEvent[] = [];
    const result = await llm.execute({
      ...ctx({ ...llm.defaultConfig, presetId: preset.id, provider: 'fake', streaming: false }),
      nodeId: 'llm-node',
      emit: (event) => events.push(event),
    });
    expect(result).toEqual({ text: 'whole', raw: {} });
    expect(events).toEqual([{ type: 'node:delta', nodeId: 'llm-node', detail: { reasoningDelta: 'Plan.' } }]);
  });

  it.each(['off', 'low', 'medium', 'high'] as const)(
    'passes reasoningEffort %s to the provider request',
    async (reasoningEffort) => {
      const chat = vi.fn().mockResolvedValue({ text: 'reply', raw: {} });
      useAdapter({ chat });
      await llm.execute(ctx({ ...llm.defaultConfig, presetId: preset.id, provider: 'fake', reasoningEffort }));
      expect(chat.mock.calls[0]?.[0]).toMatchObject({ reasoningEffort });
    },
  );

  it('defaults reasoningEffort to off and rejects unknown levels', () => {
    expect(llm.defaultConfig.reasoningEffort).toBe('off');
    expect(llm.configSchema.parse({ presetId: preset.id })).toMatchObject({ reasoningEffort: 'off' });
    expect(llm.configSchema.safeParse({ presetId: preset.id, reasoningEffort: 'max' }).success).toBe(false);
  });
});
