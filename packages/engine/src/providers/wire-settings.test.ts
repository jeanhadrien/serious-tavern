import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '@st/shared';
import { openrouterProvider, providerRecord } from '../test-providers.js';
import type { ChatRequest } from './index.js';
import { openaiCompatible } from './openai-compatible.js';
import { resolveWireSettings } from './wire-settings.js';

const request: ChatRequest = {
  model: 'deepseek/deepseek-r1',
  messages: [
    { role: 'system', content: 'Rules' },
    { role: 'user', content: 'Hi', name: 'Alex' },
  ],
  temperature: 0.7,
  maxTokens: 10,
};
const signal = () => new AbortController().signal;
const sentBody = (fetchMock: { mock: { calls: unknown[][] } }) =>
  JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
const completion = (message: Record<string, unknown>) =>
  new Response(JSON.stringify({ choices: [{ message: { content: 'ok', ...message } }] }));
const stream = (deltas: Record<string, unknown>[]) =>
  new Response(
    `${deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`).join('')}data: [DONE]\n\n`,
  );
const chat = (provider: Provider, overrides: Partial<ChatRequest> = {}) =>
  openaiCompatible.chat({ ...request, ...overrides }, { provider, nodeId: 'llm-1', signal: signal() });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveWireSettings', () => {
  const provider = providerRecord('mixed', {
    headers: { 'X-A': 'provider', 'X-B': 'provider' },
    extraBody: { a: 1, b: 1 },
    overrides: [
      {
        match: 'deepseek/*',
        messageName: null,
        reasoningFields: ['reasoning_content'],
        replayFields: ['signature'],
        reasoningReplayField: null,
        headers: { 'X-B': 'o1' },
      },
      { match: 'deepseek/deepseek-r1', messageName: 'speaker', extraBody: { b: 2 } },
      { match: '*-chat', extraBody: { b: 3, c: 3 } },
    ],
  });

  it('applies the first matching override, shallow-merging headers and extraBody', () => {
    expect(resolveWireSettings(provider, 'deepseek/deepseek-r1')).toEqual({
      headers: { 'X-A': 'provider', 'X-B': 'o1' },
      messageName: null,
      reasoningFields: ['reasoning_content'],
      replayFields: ['signature'],
      reasoningReplayField: null,
      extraBody: { a: 1, b: 1 },
    });
    expect(resolveWireSettings(provider, 'openai/gpt-chat')).toEqual({
      headers: { 'X-A': 'provider', 'X-B': 'provider' },
      messageName: 'name',
      reasoningFields: ['reasoning', 'reasoning_content'],
      replayFields: ['reasoning_details'],
      reasoningReplayField: 'reasoning',
      extraBody: { a: 1, b: 3, c: 3 },
    });
  });

  it('uses the provider fields when no override matches', () => {
    expect(resolveWireSettings(provider, 'deepseek')).toEqual({
      headers: provider.headers,
      messageName: 'name',
      reasoningFields: ['reasoning', 'reasoning_content'],
      replayFields: ['reasoning_details'],
      reasoningReplayField: 'reasoning',
      extraBody: provider.extraBody,
    });
  });

  it.each([
    ['*', 'any/model:free', true],
    ['openai/gpt-4*', 'openai/gpt-4o-mini', true],
    ['*/llama-*', 'meta/llama-3.1', true],
    ['gpt.4', 'gpt-4', false],
    ['openai/*', 'OpenAI/gpt-4o', false],
    ['gpt-4', 'gpt-4o', false],
  ])('glob %s on %s matches: %s', (match, model, expected) => {
    const settings = resolveWireSettings(providerRecord('p', { overrides: [{ match, messageName: null }] }), model);
    expect(settings.messageName === null).toBe(expected);
  });
});

describe('openai-compatible wire format', () => {
  it.each([
    ['name', { name: 'Alex' }],
    ['speaker', { speaker: 'Alex' }],
    [null, {}],
  ] as const)('writes message names to field %s', async (messageName, written) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion({}));
    await chat(providerRecord('p', { messageName }));
    expect(sentBody(fetchMock).messages).toEqual([
      { role: 'system', content: 'Rules' },
      { role: 'user', content: 'Hi', ...written },
    ]);
  });

  it('drops message names when the matching override sets messageName to null', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion({}));
    await chat(providerRecord('p', { overrides: [{ match: 'deepseek/*', messageName: null }] }));
    expect(sentBody(fetchMock).messages[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('merges extraBody last, over computed fields, and sends override headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion({}));
    const provider = providerRecord('p', {
      extraBody: { temperature: 0.1, reasoning: null, top_k: 5 },
      overrides: [{ match: 'deepseek/*', headers: { 'X-Model': 'r1' }, extraBody: { top_k: 9 } }],
    });
    await chat(provider, { reasoningEffort: 'high' });
    expect(sentBody(fetchMock)).toMatchObject({ temperature: 0.1, reasoning: null, top_k: 9, max_tokens: 10 });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Model': 'r1' });
  });

  it.each([
    ['reasoning', ['reasoning', 'reasoning_content']],
    ['reasoning_content', ['reasoning', 'reasoning_content']],
    ['thinking', ['thinking']],
  ])('reads non-stream reasoning from %s', async (field, reasoningFields) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion({ reasoning: '', [field]: 'Because' }));
    const result = await chat(providerRecord('p', { reasoningFields }));
    expect(result).toMatchObject({ text: 'ok', reasoning: 'Because' });
  });

  it('ignores reasoning fields the record does not list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion({ reasoning_content: 'hidden' }));
    const result = await chat(providerRecord('p', { overrides: [{ match: '*', reasoningFields: ['reasoning'] }] }));
    expect(result.reasoning).toBeUndefined();
  });

  it.each([
    ['reasoning', ['reasoning', 'reasoning_content']],
    ['reasoning_content', ['reasoning', 'reasoning_content']],
    ['thinking', ['thinking']],
  ])('streams reasoning deltas from %s and reports them as raw `reasoning`', async (field, reasoningFields) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      stream([{ [field]: 'Think ' }, { reasoning: null, [field]: 'more' }, { content: 'Done' }]),
    );
    const onReasoning = vi.fn();
    const result = await openaiCompatible.stream!(request, {
      provider: providerRecord('p', { reasoningFields }),
      nodeId: 'llm-1',
      signal: signal(),
      onToken: () => {},
      onReasoning,
    });
    expect(onReasoning.mock.calls).toEqual([['Think '], ['more']]);
    expect(result).toMatchObject({
      text: 'Done',
      reasoning: 'Think more',
      raw: { choices: [{ message: { role: 'assistant', content: 'Done', reasoning: 'Think more' } }] },
    });
  });

  it('keeps the built-in OpenRouter request shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion({}));
    await openaiCompatible.chat(
      { ...request, reasoningEffort: 'low' },
      { provider: openrouterProvider, apiKey: 'k', nodeId: 'llm-1', signal: signal() },
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init as RequestInit).headers).toEqual({
      Authorization: 'Bearer k',
      'Content-Type': 'application/json',
      ...openrouterProvider.headers,
    });
    expect(sentBody(fetchMock)).toEqual({
      model: 'deepseek/deepseek-r1',
      messages: request.messages,
      temperature: 0.7,
      max_tokens: 10,
      reasoning: { effort: 'low' },
    });
  });
});
