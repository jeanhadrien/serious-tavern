import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptMessage, ToolDefinition, WireExchange } from '@st/shared';
import { openrouterProvider, providerRecord } from '../test-providers.js';
import type { ChatRequest } from './index.js';
import { openaiCompatible } from './openai-compatible.js';

const lookup: ToolDefinition = {
  type: 'function',
  function: { name: 'lookup', description: 'Find a fact', parameters: { type: 'object', properties: {} } },
};
const request: ChatRequest = {
  model: 'test/model',
  messages: [{ role: 'user', content: 'Hi' }],
  temperature: 0.7,
  maxTokens: 10,
};
const options = (provider = openrouterProvider) => ({
  provider,
  apiKey: 'sk-test-key',
  nodeId: 'llm-1',
  signal: new AbortController().signal,
});
const call = (id: string, name: string, args: string, extra: object = {}) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: args },
  ...extra,
});
// The JSON body of the nth fetch call.
const sentBody = (fetchMock: { mock: { calls: unknown[][] } }, n = 0) =>
  JSON.parse(String((fetchMock.mock.calls[n]?.[1] as RequestInit | undefined)?.body));
const reply = (message: object, finish_reason = 'stop') => Response.json({ choices: [{ message, finish_reason }] });
const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;
const sse = (...frames: unknown[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(new TextEncoder().encode(event(frame)));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
  );
const delta = (delta: object, finish_reason: string | null = null) => ({ choices: [{ delta, finish_reason }] });
const stream = () => openaiCompatible.stream!(request, { ...options(), onToken: vi.fn(), onReasoning: vi.fn() });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request', () => {
  it('sends tools, tool_choice and parallel_tool_calls only when set, before extraBody', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => reply({ content: 'ok' }));
    await openaiCompatible.chat(request, options());
    for (const field of ['tools', 'tool_choice', 'parallel_tool_calls'])
      expect(sentBody(fetchMock)).not.toHaveProperty(field);
    // An empty list is not sent: backends refuse `tools: []`.
    await openaiCompatible.chat({ ...request, tools: [] }, options());
    expect(sentBody(fetchMock, 1)).not.toHaveProperty('tools');

    const provider = providerRecord('p', { extraBody: { tool_choice: 'none' } });
    await openaiCompatible.chat(
      { ...request, tools: [lookup], toolChoice: 'required', parallelToolCalls: false },
      options(provider),
    );
    const body = sentBody(fetchMock, 2);
    expect(body).toMatchObject({ tools: [lookup], parallel_tool_calls: false });
    // extraBody still wins.
    expect(body.tool_choice).toBe('none');
  });

  it('serializes tool calls verbatim, the null content rule, tool results and provider data', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => reply({ content: 'ok' }));
    const toolCall = call('call_1', 'lookup', '{"q": "x"}', { extra_content: { google: { thought_signature: 's' } } });
    const messages: PromptMessage[] = [
      { role: 'user', content: 'Hi', name: 'Alex' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall],
        reasoning: 'I should look it up',
        provider_data: { reasoning_details: [{ type: 'reasoning.text', text: 'hm' }] },
        provenance: { providerId: 'openrouter', model: 'm', nodeId: 'llm-1' },
      },
      { role: 'tool', content: 'fact', tool_call_id: 'call_1' },
      { role: 'assistant', content: 'Done', reasoning: 'Fine' },
      { role: 'assistant', content: '', tool_calls: [] },
    ];
    await openaiCompatible.chat({ ...request, messages }, options());
    expect(sentBody(fetchMock).messages).toEqual([
      { role: 'user', content: 'Hi', name: 'Alex' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [toolCall],
        reasoning: 'I should look it up',
        reasoning_details: [{ type: 'reasoning.text', text: 'hm' }],
      },
      { role: 'tool', content: 'fact', tool_call_id: 'call_1' },
      { role: 'assistant', content: 'Done', reasoning: 'Fine' },
      // An empty tool_calls list is not a tool call.
      { role: 'assistant', content: '' },
    ]);
  });

  it('never sends reasoning without a reasoningReplayField, and an override can turn it off', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => reply({ content: 'ok' }));
    const messages: PromptMessage[] = [{ role: 'assistant', content: 'Done', reasoning: 'Fine' }];
    const body = async (provider: ReturnType<typeof providerRecord>, model = 'test/model') => {
      fetchMock.mockClear();
      await openaiCompatible.chat({ ...request, model, messages }, options(provider));
      return sentBody(fetchMock).messages[0];
    };
    expect(await body(providerRecord('a', { reasoningReplayField: null }))).toEqual({
      role: 'assistant',
      content: 'Done',
    });
    expect(await body(providerRecord('b', { reasoningReplayField: 'reasoning_content' }))).toHaveProperty(
      'reasoning_content',
      'Fine',
    );
    const overridden = providerRecord('c', {
      reasoningReplayField: 'reasoning',
      overrides: [{ match: 'test/*', reasoningReplayField: null }],
    });
    expect(await body(overridden)).not.toHaveProperty('reasoning');
  });
});

describe('response (not streamed)', () => {
  it('reads tool calls, null content, the finish reason and replay fields into the canonical message', async () => {
    const toolCall = call('call_1', 'lookup', '{"q":"x"}', { extra_content: { sig: 'abc' } });
    const details = [{ type: 'reasoning.text', text: 'hm' }];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      reply(
        { content: null, tool_calls: [toolCall], reasoning: 'Look it up', reasoning_details: details },
        'tool_calls',
      ),
    );
    const result = await openaiCompatible.chat({ ...request, tools: [lookup] }, options());
    expect(result.text).toBe('');
    expect(result.finishReason).toBe('tool_calls');
    expect(result.reasoning).toBe('Look it up');
    expect(result.message).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [toolCall],
      reasoning: 'Look it up',
      provider_data: { reasoning_details: details },
      provenance: { providerId: 'openrouter', model: 'test/model', nodeId: 'llm-1' },
    });
    // The raw response is the upstream JSON, tool calls included.
    expect(result.raw).toMatchObject({ choices: [{ message: { tool_calls: [toolCall] } }] });
  });

  it('only copies the replay fields the record names, and none when it names none', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      reply({ content: 'ok', reasoning_details: [{ a: 1 }], other: 'x' }),
    );
    const none = await openaiCompatible.chat(request, options(providerRecord('p', { replayFields: [] })));
    expect(none.message).not.toHaveProperty('provider_data');
    const some = await openaiCompatible.chat(request, options(providerRecord('p', { replayFields: ['other'] })));
    expect(some.message.provider_data).toEqual({ other: 'x' });
  });

  it('fails only when there is neither content nor tool calls, or a call is malformed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementation(async () => reply({ content: null }));
    await expect(openaiCompatible.chat(request, options())).rejects.toThrow('OpenRouter returned no assistant text');
    fetchMock.mockImplementation(async () => reply({ content: '' }));
    await expect(openaiCompatible.chat(request, options())).resolves.toMatchObject({ text: '' });
    fetchMock.mockImplementation(async () => reply({ content: null, tool_calls: [{ function: { name: 'x' } }] }));
    await expect(openaiCompatible.chat(request, options())).rejects.toThrow('returned a malformed tool call');
  });
});

describe('response (streamed)', () => {
  it('merges tool call deltas by index: arguments concatenated, id and name once, other fields merged', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValue(
      sse(
        delta({
          role: 'assistant',
          content: null,
          tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'lookup', arguments: '' } }],
        }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] }),
        // The second call interleaves with the first; some backends repeat the name on every chunk.
        delta({
          tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'lookup', arguments: '{"q"' } }],
        }),
        delta({ tool_calls: [{ index: 0, function: { name: 'lookup', arguments: ' "x"' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '}' } }] }),
        delta({
          tool_calls: [
            { index: 1, extra_content: { google: { thought_signature: 'sig' } }, function: { arguments: ':"y"}' } },
          ],
        }),
        delta({}, 'tool_calls'),
      ),
    );
    const result = await stream();
    expect(result.message.tool_calls).toEqual([
      call('call_a', 'lookup', '{"q": "x"}'),
      call('call_b', 'lookup', '{"q":"y"}', { extra_content: { google: { thought_signature: 'sig' } } }),
    ]);
    expect(result.message.content).toBe('');
    expect(result.finishReason).toBe('tool_calls');
    expect(result.raw).toMatchObject({ choices: [{ message: { tool_calls: result.message.tool_calls } }] });
  });

  it('streams text and a tool call together, folding replay fields from the deltas', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sse(
        delta({ content: 'Let me ', reasoning: 'hm', reasoning_details: [{ i: 1 }] }),
        delta({ content: 'check.', reasoning_details: [{ i: 2 }] }),
        delta({ tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }),
        delta({}, 'tool_calls'),
      ),
    );
    const onToken = vi.fn();
    const result = await openaiCompatible.stream!(request, { ...options(), onToken, onReasoning: vi.fn() });
    // Only text is streamed; tool call deltas are not.
    expect(onToken.mock.calls).toEqual([['Let me '], ['check.']]);
    expect(result.message).toEqual({
      role: 'assistant',
      content: 'Let me check.',
      tool_calls: [call('c', 'lookup', '{}')],
      reasoning: 'hm',
      provider_data: { reasoning_details: [{ i: 1 }, { i: 2 }] },
      provenance: { providerId: 'openrouter', model: 'test/model', nodeId: 'llm-1' },
    });
    expect(result.text).toBe('Let me check.');
  });

  it('logs the folded tool calls on the wire, under the backend field names', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sse(
        delta({
          tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: 'lookup', arguments: '{"a"' } }],
        }),
        delta({ tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }),
      ),
    );
    const reports: WireExchange[] = [];
    await openaiCompatible.stream!(request, {
      ...options(),
      onWire: (exchange) => reports.push(exchange),
      onToken: vi.fn(),
      onReasoning: vi.fn(),
    });
    expect(reports.at(-1)?.response).toMatchObject({
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'lookup', arguments: '{"a":1}' } }] } }],
    });
  });
});

describe('wire log per call', () => {
  it('reports each call on its own, so a caller can keep one entry per call', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => reply({ content: 'ok' }));
    const reports: WireExchange[] = [];
    const onWire = (exchange: WireExchange) => reports.push(exchange);
    await openaiCompatible.chat(request, { ...options(), onWire });
    await openaiCompatible.chat(request, { ...options(), onWire });
    // Request, then response, for each call.
    expect(reports.map((report) => report.status)).toEqual([undefined, 200, undefined, 200]);
  });
});
