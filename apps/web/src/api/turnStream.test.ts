import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from './transport.js';
import { streamMessage, streamRegenerate } from './turnStream.js';

const execution = { id: 'e', workflowId: 'w', sessionId: 's', status: 'completed', startedAt: '', nodes: {} };
const user = { id: 'u', role: 'user', content: 'hi', createdAt: '' };
const frame = (event: Record<string, unknown>) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

function respondWith(chunks: string[], init: ResponseInit = { status: 200 }) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, init)));
}

afterEach(() => vi.unstubAllGlobals());

it('dispatches deltas and the completed turn, even when frames are split across chunks', async () => {
  const text = frame({ type: 'node.delta', nodeId: 'out', textDelta: 'Hi' });
  const done = frame({ type: 'turn.complete', userMessage: user, assistantMessages: [], execution });
  respondWith([frame({ type: 'turn.start', executionId: 'e' }), text.slice(0, 20), text.slice(20) + done]);
  const deltas: string[] = [];
  const completed = vi.fn();
  const started = vi.fn();
  await streamMessage('s', 'hi', {
    onStart: started,
    onDelta: ({ textDelta }) => deltas.push(textDelta ?? ''),
    onComplete: completed,
  });
  expect(deltas).toEqual(['Hi']);
  expect(started).toHaveBeenCalledOnce();
  expect(completed).toHaveBeenCalledOnce();
});

it('throws the server error of a failed turn with its details', async () => {
  const details = { userMessage: user, assistantMessages: [], execution, aborted: 'user' };
  respondWith([frame({ type: 'turn.error', error: { code: 'TURN_STOPPED', message: 'Stopped', details } })]);
  await expect(streamMessage('s', 'hi', {})).rejects.toMatchObject({ code: 'TURN_STOPPED', details });
});

it('turns a non-2xx response into an ApiError and a cut connection into a network error', async () => {
  respondWith([JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No session' } })], { status: 404 });
  await expect(streamMessage('s', 'hi', {})).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  respondWith([frame({ type: 'turn.start', executionId: 'e' })]);
  const error = await streamMessage('s', 'hi', {}).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ code: 'NETWORK_ERROR' });
});

it('regenerates through its own route with no body and no content type, and reads the same events', async () => {
  respondWith([
    frame({ type: 'turn.start', executionId: 'e' }),
    frame({ type: 'turn.complete', assistantMessages: [], execution }),
  ]);
  const completed = vi.fn();
  await streamRegenerate('s', { onComplete: completed });
  const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(url).toBe('/api/sessions/s/regenerate/stream');
  expect(init).toMatchObject({ method: 'POST' });
  expect(init?.body).toBeUndefined();
  expect(init?.headers).toBeUndefined();
  expect(completed).toHaveBeenCalledOnce();
});

it('tells each run of a reply list apart: run.start, then node events tagged with their run', async () => {
  const done = frame({
    type: 'turn.complete',
    assistantMessages: [],
    execution,
    executions: [execution, { ...execution, id: 'f' }],
  });
  respondWith([
    frame({ type: 'turn.start', executionId: 'e' }),
    frame({ type: 'run.start', runId: 'e', workflowId: 'w1', workflowName: 'First' }),
    frame({ type: 'node.delta', nodeId: 'out', runId: 'e', textDelta: 'A' }),
    frame({ type: 'run.start', runId: 'f', workflowId: 'w2', workflowName: 'Second' }),
    frame({ type: 'node.delta', nodeId: 'out', runId: 'f', reasoningDelta: 'think' }),
    done,
  ]);
  const seen: unknown[] = [];
  const completed = vi.fn();
  await streamMessage('s', 'hi', {
    onRun: (run) => seen.push(run),
    onDelta: (delta) => seen.push(delta),
    onComplete: completed,
  });
  expect(seen).toEqual([
    { runId: 'e', workflowId: 'w1', workflowName: 'First' },
    { nodeId: 'out', runId: 'e', textDelta: 'A' },
    { runId: 'f', workflowId: 'w2', workflowName: 'Second' },
    { nodeId: 'out', runId: 'f', reasoningDelta: 'think' },
  ]);
  expect(completed.mock.calls[0]?.[0].executions).toHaveLength(2);
});

it('still reads the events of a run without ids (a single-run server)', async () => {
  respondWith([
    frame({ type: 'node.delta', nodeId: 'out', textDelta: 'Hi' }),
    frame({ type: 'turn.complete', assistantMessages: [], execution }),
  ]);
  const deltas: unknown[] = [];
  await streamMessage('s', 'hi', { onDelta: (delta) => deltas.push(delta) });
  expect(deltas).toEqual([{ nodeId: 'out', textDelta: 'Hi' }]);
});
