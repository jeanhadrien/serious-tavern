import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WireExchange } from '@st/shared';
import { providerRecord } from '../test-providers.js';
import type { ChatRequest } from './index.js';
import { openaiCompatible } from './openai-compatible.js';

const secret = 'sk-very-secret';
const request: ChatRequest = {
  model: 'deepseek/deepseek-r1',
  messages: [
    { role: 'system', content: 'Rules' },
    { role: 'user', content: 'Hi', name: 'Alex' },
  ],
  temperature: 0.7,
  maxTokens: 10,
  reasoningEffort: 'low',
};
// Mapped message names, an override, extraBody on both levels and credential-looking custom headers.
const provider = providerRecord('mapped', {
  secret: 'mapped-key',
  headers: { 'X-Title': 'Tavern', 'X-Api-Key': 'typed-into-the-record', 'X-Auth-Token': 'Token abc' },
  messageName: 'speaker',
  extraBody: { top_k: 40, reasoning: null },
  overrides: [{ match: 'deepseek/*', extraBody: { top_k: 20, provider: { order: ['a'] } } }],
});
const sent = (fetchMock: { mock: { calls: unknown[][] } }) =>
  JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));

function recorder() {
  const reports: WireExchange[] = [];
  return { reports, onWire: (exchange: WireExchange) => reports.push(exchange) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wire log', () => {
  it('records the exact body fetch received, the URL and redacted headers, then the response', async () => {
    const upstream = { id: 'gen-1', choices: [{ message: { content: 'ok', reasoning_content: 'Hmm' } }] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(upstream));
    const { reports, onWire } = recorder();
    await openaiCompatible.chat(request, { provider, apiKey: secret, signal: new AbortController().signal, onWire });
    expect(reports).toHaveLength(2);
    const [before, after] = reports;
    expect(before).not.toHaveProperty('status');
    expect(after).toEqual({
      url: 'https://mapped.test/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: 'Bearer [redacted]',
        'Content-Type': 'application/json',
        'X-Title': 'Tavern',
        'X-Api-Key': '[redacted]',
        'X-Auth-Token': 'Token [redacted]',
      },
      body: sent(fetchMock),
      status: 200,
      response: upstream,
    });
    // The mapping, the override and extraBody are visible as sent.
    expect(after?.body).toMatchObject({
      messages: [
        { role: 'system', content: 'Rules' },
        { role: 'user', content: 'Hi', speaker: 'Alex' },
      ],
      top_k: 20,
      reasoning: null,
      provider: { order: ['a'] },
    });
    expect(JSON.stringify(reports)).not.toContain(secret);
    expect(JSON.stringify(reports)).not.toContain('typed-into-the-record');
  });

  it('records an error response, scrubbing a secret the backend echoes back', async () => {
    const error = { error: { message: `Invalid key ${secret}` } };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(error, { status: 401 }));
    const { reports, onWire } = recorder();
    const call = openaiCompatible.chat(request, {
      provider,
      apiKey: secret,
      signal: new AbortController().signal,
      onWire,
    });
    await expect(call).rejects.toThrow('mapped 401');
    expect(reports.at(-1)).toMatchObject({
      status: 401,
      response: { error: { message: 'Invalid key [redacted]' } },
    });
    expect(JSON.stringify(reports)).not.toContain(secret);
  });

  it('keeps a non-JSON response as text', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('<html>Bad gateway</html>'));
    const { reports, onWire } = recorder();
    const call = openaiCompatible.chat(request, { provider, signal: new AbortController().signal, onWire });
    await expect(call).rejects.toThrow('not JSON');
    expect(reports.at(-1)).toMatchObject({ status: 200, response: '<html>Bad gateway</html>' });
  });

  it('folds stream chunks under their wire field names', async () => {
    const chunks = [
      { id: 'gen-2', model: 'm', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Th' } }] },
      { id: 'gen-2', model: 'm', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'ink' } }] },
      { id: 'gen-2', choices: [{ index: 0, delta: { content: 'Hel', reasoning_content: null } }] },
      { id: 'gen-2', choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: 'stop' }], usage: { total: 3 } },
    ];
    const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body));
    const { reports, onWire } = recorder();
    const response = await openaiCompatible.stream!(request, {
      provider,
      apiKey: secret,
      signal: new AbortController().signal,
      onWire,
      onToken: () => {},
      onReasoning: () => {},
    });
    expect(reports.at(-1)?.body).toEqual(sent(fetchMock));
    expect(reports.at(-1)?.body).toMatchObject({ stream: true });
    expect(reports.at(-1)).toMatchObject({
      status: 200,
      response: {
        id: 'gen-2',
        model: 'm',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', reasoning_content: 'Think', content: 'Hello' },
            finish_reason: 'stop',
          },
        ],
        usage: { total: 3 },
      },
    });
    // The node's `raw` output keeps its documented, mapping-independent shape.
    expect(response.raw).toMatchObject({ choices: [{ message: { content: 'Hello', reasoning: 'Think' } }] });
  });

  it('records what had arrived when a stream fails midway', async () => {
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hal' } }] })}\n\ndata: {"error":{"message":"overloaded"}}\n\n`;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body));
    const { reports, onWire } = recorder();
    const call = openaiCompatible.stream!(request, {
      provider,
      signal: new AbortController().signal,
      onWire,
      onToken: () => {},
      onReasoning: () => {},
    });
    await expect(call).rejects.toThrow('overloaded');
    expect(reports.at(-1)?.response).toEqual({
      choices: [{ delta: { content: 'Hal' } }],
      error: { message: 'overloaded' },
    });
  });
});
