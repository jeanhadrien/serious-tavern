import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from './index.js';
import { openrouter } from './openrouter.js';

const request: ChatRequest = {
  model: 'test',
  messages: [{ role: 'user', content: 'Hi' }],
  temperature: 0.7,
  maxTokens: 10,
};
const options = (signal = new AbortController().signal) => ({ apiKey: 'test-key', signal });
const event = (payload: unknown, lineEnding = '\n') => `data: ${JSON.stringify(payload)}${lineEnding}${lineEnding}`;
// Each part is one network read, so callers control where frames are split.
const streamResponse = (parts: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
    { status: 200 },
  );
const sentBody = (fetchMock: { mock: { calls: unknown[][] } }) =>
  JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
const callbacks = () => ({ onToken: vi.fn(), onReasoning: vi.fn() });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenRouter streaming', () => {
  it('parses reply and reasoning deltas from frames split at arbitrary byte boundaries', async () => {
    const body = [
      ': OPENROUTER PROCESSING\n\n',
      event({ id: 'gen-1', model: 'test', choices: [{ delta: { reasoning: 'Think ' } }] }),
      event({ choices: [{ delta: { reasoning: 'first' } }] }, '\r\n'),
      event({ choices: [{ delta: { content: 'Hello' } }] }),
      event({ choices: [{ delta: { content: null } }] }),
      event({ choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }], usage: { total_tokens: 3 } }),
      'data: [DONE]\n\n',
    ].join('');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse(body.match(/[\s\S]{1,7}/g) ?? []));
    const { onToken, onReasoning } = callbacks();
    const result = await openrouter.stream!(
      { ...request, reasoningEffort: 'high' },
      { ...options(), onToken, onReasoning },
    );
    expect(onToken.mock.calls).toEqual([['Hello'], [' world']]);
    expect(onReasoning.mock.calls).toEqual([['Think '], ['first']]);
    expect(result).toEqual({
      text: 'Hello world',
      usage: { total_tokens: 3 },
      raw: {
        id: 'gen-1',
        model: 'test',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello world', reasoning: 'Think first' },
            finish_reason: 'stop',
          },
        ],
        usage: { total_tokens: 3 },
      },
    });
    expect(sentBody(fetchMock)).toMatchObject({ stream: true, reasoning: { effort: 'high' } });
  });

  it.each([
    ['off', undefined],
    ['low', { effort: 'low' }],
    ['medium', { effort: 'medium' }],
    ['high', { effort: 'high' }],
    ['minimal', { effort: 'minimal' }],
    ['xhigh', { effort: 'xhigh' }],
  ] as const)('maps reasoningEffort %s to %j, leaving "off" to the provider default', async (effort, reasoning) => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(streamResponse([`${event({ choices: [{ delta: { content: 'ok' } }] })}data: [DONE]\n\n`]));
    await openrouter.stream!({ ...request, reasoningEffort: effort }, { ...options(), ...callbacks() });
    expect(sentBody(fetchMock).reasoning).toEqual(reasoning);
  });

  it('sends the reasoning budget and exclude flag independently of effort', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamResponse([
        `${event({ choices: [{ delta: { content: 'ok' } }] })}data: [DONE]

`,
      ]),
    );
    await openrouter.stream!(
      { ...request, reasoningMaxTokens: 2000, reasoningExclude: true },
      { ...options(), ...callbacks() },
    );
    expect(sentBody(fetchMock).reasoning).toEqual({ max_tokens: 2000, exclude: true });
  });

  it('fails the stream on an error frame after partial output', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamResponse([
        event({ choices: [{ delta: { content: 'Partial' } }] }),
        event({ error: { message: 'Insufficient credits' } }),
      ]),
    );
    const { onToken, onReasoning } = callbacks();
    await expect(openrouter.stream!(request, { ...options(), onToken, onReasoning })).rejects.toThrow(
      'OpenRouter stream error: Insufficient credits',
    );
    expect(onToken).toHaveBeenCalledWith('Partial');
  });

  it('decodes HTTP errors before reading any stream', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'limited' } }), { status: 429 }),
    );
    await expect(openrouter.stream!(request, { ...options(), ...callbacks() })).rejects.toThrow(
      'OpenRouter 429: limited',
    );
  });

  it('rejects when the request is aborted mid-stream and passes the signal to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const signal = init?.signal as AbortSignal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { content: 'Hel' } }] })));
            // Like fetch, the body errors with the abort reason once the signal fires.
            signal.addEventListener('abort', () => stream.error(signal.reason), { once: true });
          },
        }),
      );
    });
    const onToken = vi.fn(() => controller.abort(new Error('client left')));
    await expect(
      openrouter.stream!(request, { ...options(controller.signal), onToken, onReasoning: () => {} }),
    ).rejects.toThrow('client left');
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
    expect(onToken).toHaveBeenCalledTimes(1);
  });
});
