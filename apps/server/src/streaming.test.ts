import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ChatRequest, StreamOptions } from '@st/engine';
import {
  apiContract,
  turnEventSchema,
  type ChatMessage,
  type Edge,
  type ExecutionLog,
  type Session,
  type Workflow,
} from '@st/shared';
import { createApp } from './app.js';
import { historyMessages, settleTurn } from './services/chat.js';
import { restoreAdapter, useAdapter } from './test-support/adapter.js';
import { parseEventStream } from './test-support/event-stream.js';

type Script = (request: ChatRequest, options: StreamOptions) => Promise<{ text: string; raw: unknown }>;
type Frame = ReturnType<typeof parseEventStream>[number];

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  restoreAdapter();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});
const llmNode = (id: string, presetId: string, provider: string, model = 'stream-model') =>
  node(id, 'llm', { presetId, provider, model });
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

// The built-in OpenRouter record resolves to a scripted adapter; its `openrouter` secret is set by `setup`.
function useProvider(script: Script): string {
  useAdapter({
    chat: async () => {
      throw new Error('These tests stream');
    },
    stream: script,
  });
  return 'openrouter';
}

// Builds the app, a stream-test API key, a preset, a workflow and a session. Nodes get the preset id.
async function setup(build: (presetId: string) => { nodes: Workflow['nodes']; edges: Edge[] }) {
  const directory = join(process.cwd(), '.test-data', `streaming-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
  const preset = (
    await app.inject({ method: 'POST', url: '/api/presets', payload: { name: 'Stream', inputs: [], entries: [] } })
  ).json();
  const created = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Streaming' } })).json();
  const { nodes, edges } = build(preset.id);
  await app.inject({
    method: 'PUT',
    url: `/api/workflows/${created.id}`,
    payload: { name: 'Streaming', nodes, edges },
  });
  const session = (
    await app.inject({ method: 'POST', url: '/api/sessions', payload: { workflowId: created.id } })
  ).json();
  return { app, session: session as { id: string } };
}

const streamRequest = (sessionId: string, content: string) => ({
  method: 'POST' as const,
  url: `/api/sessions/${sessionId}/messages/stream`,
  payload: { content },
});
const stopRequest = (sessionId: string) => ({ method: 'POST' as const, url: `/api/sessions/${sessionId}/stop` });

async function readSession(app: Awaited<ReturnType<typeof setup>>['app'], sessionId: string): Promise<Session> {
  return apiContract.getSession.response.parse(
    (await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}` })).json(),
  );
}
async function readExecution(
  app: Awaited<ReturnType<typeof setup>>['app'],
  executionId: string,
): Promise<ExecutionLog> {
  return apiContract.getExecution.response.parse(
    (await app.inject({ method: 'GET', url: `/api/executions/${executionId}` })).json(),
  );
}
const assistantRows = (session: Session) => session.messages.filter((message) => message.role === 'assistant');

// Polls until the read returns a value. Flushes are timed at 250ms, so tests wait for them rather than sleeping.
// Counts attempts rather than reading the clock, because some tests fake Date.
async function waitFor<T>(read: () => Promise<T | undefined>, attempts = 200): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the condition');
}

function framesOf(body: string) {
  return parseEventStream(body).map((frame) => ({ ...frame, data: turnEventSchema.parse(frame.data) }));
}

// Reads SSE frames from a live response as they arrive, so a test can act between them.
async function* readFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<Frame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      yield parseEventStream(buffer.slice(0, end + 2))[0]!;
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf('\n\n');
    }
    if (done) return;
  }
}

async function nextFrameOfType(frames: AsyncGenerator<Frame>, type: string): Promise<Frame> {
  for (;;) {
    const { value, done } = await frames.next();
    if (done) throw new Error(`Stream ended before ${type}`);
    if (value.data.type === type) return value;
  }
}

describe('streamed turns', () => {
  it('streams passthrough text into a streaming row, then promotes that row in place', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const provider = useProvider(async (_request, { onToken, onReasoning }) => {
      onReasoning('think');
      onToken('Hel');
      await gate;
      onToken('lo');
      await finished;
      return { text: 'Hello', raw: {} };
    });
    const { app, session } = await setup((presetId) => ({
      nodes: [node('input', 'chat-input'), llmNode('llm', presetId, provider), node('output', 'chat-output')],
      edges: [edge('llm', 'text', 'output', 'value')],
    }));
    try {
      const turn = app.inject(streamRequest(session.id, 'hi'));
      const row = await waitFor(async () => {
        const current = await readSession(app, session.id);
        return assistantRows(current).find((message) => message.content === 'Hel');
      });
      expect(row).toMatchObject({ status: 'streaming', nodeId: 'output', reasoning: 'think' });
      const updatedAt = (await readSession(app, session.id)).updatedAt;
      // Flushes write message text only; the session's updatedAt keeps the send time.
      vi.setSystemTime(new Date('2030-01-01T00:05:00.000Z'));
      release();
      await waitFor(async () =>
        assistantRows(await readSession(app, session.id)).find((message) => message.content === 'Hello'),
      );
      expect((await readSession(app, session.id)).updatedAt).toBe(updatedAt);
      finish();
      const response = await turn;
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      const frames = framesOf(response.body);
      const start = frames.find((frame) => frame.data.type === 'turn.start')!.data;
      expect(frames[0]!.event).toBe('turn.start');
      const deltas = frames.filter((frame) => frame.data.type === 'node.delta').map((frame) => frame.data);
      expect(deltas).toEqual([
        { type: 'node.delta', nodeId: 'output', reasoningDelta: 'think', textDelta: 'Hel' },
        { type: 'node.delta', nodeId: 'output', textDelta: 'lo' },
      ]);
      expect(frames.at(-1)!.data).toMatchObject({
        type: 'turn.complete',
        assistantMessages: [
          {
            id: row!.id,
            role: 'assistant',
            content: 'Hello',
            status: 'final',
            nodeId: 'output',
            reasoning: 'think',
            executionId: (start as unknown as { executionId: string }).executionId,
          },
        ],
      });
      const saved = await readSession(app, session.id);
      expect(saved.messages.map((message) => [message.role, message.id])).toEqual([
        ['user', saved.messages[0]!.id],
        ['assistant', row!.id],
      ]);
      expect(saved.messages[1]).toMatchObject({ content: 'Hello', status: 'final' });
    } finally {
      await app.close();
    }
  });

  it('stores the reasoning of a non-streamed LLM call on its reply, like streamed reasoning', async () => {
    useAdapter({ chat: async () => ({ text: 'Hello', reasoning: 'think', raw: {} }) });
    const { app, session } = await setup((presetId) => ({
      nodes: [
        node('input', 'chat-input'),
        node('llm', 'llm', { presetId, provider: 'openrouter', model: 'm', streaming: false }),
        node('output', 'chat-output'),
      ],
      edges: [edge('llm', 'text', 'output', 'value')],
    }));
    try {
      const frames = framesOf((await app.inject(streamRequest(session.id, 'hi'))).body);
      expect(frames.filter((frame) => frame.data.type === 'node.delta').map((frame) => frame.data)).toEqual([
        { type: 'node.delta', nodeId: 'output', reasoningDelta: 'think' },
      ]);
      expect(frames.at(-1)!.data).toMatchObject({
        type: 'turn.complete',
        assistantMessages: [{ content: 'Hello', reasoning: 'think', status: 'final' }],
      });
      expect(assistantRows(await readSession(app, session.id))).toMatchObject([
        { content: 'Hello', reasoning: 'think', status: 'final' },
      ]);
    } finally {
      await app.close();
    }
  });

  it('keeps templated outputs off the live stream and writes them once, at completion', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const provider = useProvider(async (_request, { onToken }) => {
      onToken('Hi');
      await gate;
      return { text: 'Hi', raw: {} };
    });
    const { app, session } = await setup((presetId) => ({
      nodes: [
        node('input', 'chat-input'),
        llmNode('llm', presetId, provider),
        node('output', 'chat-output', { template: '[{{input.value}}]' }),
      ],
      edges: [edge('llm', 'text', 'output', 'value')],
    }));
    try {
      const turn = app.inject(streamRequest(session.id, 'hi'));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(assistantRows(await readSession(app, session.id))).toEqual([]);
      release();
      const response = await turn;
      const frames = framesOf(response.body);
      expect(frames.some((frame) => frame.data.type === 'node.delta')).toBe(false);
      const [reply] = assistantRows(await readSession(app, session.id));
      expect(reply).toMatchObject({ content: '[Hi]' });
      expect(reply).not.toHaveProperty('status');
      expect(reply).not.toHaveProperty('nodeId');
    } finally {
      await app.close();
    }
  });

  it('keeps streamed replies in output order even when a later output streams first', async () => {
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => (releaseSlow = resolve));
    let finishFast!: () => void;
    const fastGate = new Promise<void>((resolve) => (finishFast = resolve));
    const provider = useProvider(async (request, { onToken }) => {
      if (request.model === 'fast') {
        onToken('first');
        await fastGate;
        return { text: 'first', raw: {} };
      }
      await slowGate;
      onToken('second');
      return { text: 'second', raw: {} };
    });
    const { app, session } = await setup((presetId) => ({
      nodes: [
        node('input', 'chat-input'),
        llmNode('fast', presetId, provider, 'fast'),
        llmNode('slow', presetId, provider, 'slow'),
        node('fast-output', 'chat-output', { order: 1 }),
        node('slow-output', 'chat-output', { order: 0 }),
      ],
      edges: [edge('fast', 'text', 'fast-output', 'value'), edge('slow', 'text', 'slow-output', 'value')],
    }));
    try {
      const turn = app.inject(streamRequest(session.id, 'hi'));
      await waitFor(async () =>
        assistantRows(await readSession(app, session.id)).find((message) => message.content === 'first'),
      );
      releaseSlow();
      await waitFor(async () => {
        const rows = assistantRows(await readSession(app, session.id));
        return rows.some((message) => message.content === 'second') ? rows : undefined;
      });
      const midStream = assistantRows(await readSession(app, session.id)).map((message) => message.content);
      expect(midStream).toEqual(['second', 'first']);
      finishFast();
      await turn;
      expect(assistantRows(await readSession(app, session.id)).map((message) => message.content)).toEqual([
        'second',
        'first',
      ]);
    } finally {
      await app.close();
    }
  });

  it('stops on request: aborts the provider, keeps the partial row, and ends with TURN_STOPPED', async () => {
    let providerAborted = false;
    const provider = useProvider(async (_request, { onToken, signal }) => {
      onToken('Par');
      await new Promise<never>((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            providerAborted = true;
            reject(new Error('upstream aborted'));
          },
          { once: true },
        ),
      );
      throw new Error('unreachable');
    });
    const { app, session } = await setup((presetId) => ({
      nodes: [node('input', 'chat-input'), llmNode('llm', presetId, provider), node('output', 'chat-output')],
      edges: [edge('llm', 'text', 'output', 'value')],
    }));
    try {
      const turn = app.inject(streamRequest(session.id, 'hi'));
      await waitFor(async () =>
        assistantRows(await readSession(app, session.id)).find((message) => message.content === 'Par'),
      );
      expect((await app.inject(stopRequest(session.id))).statusCode).toBe(204);
      const response = await turn;
      const frames = framesOf(response.body);
      const executionId = (frames[0]!.data as unknown as { executionId: string }).executionId;
      expect(frames.at(-1)!.data).toMatchObject({
        type: 'turn.error',
        error: {
          code: 'TURN_STOPPED',
          details: { aborted: 'user', assistantMessages: [{ content: 'Par', status: 'partial', nodeId: 'output' }] },
        },
      });
      expect(providerAborted).toBe(true);
      expect(assistantRows(await readSession(app, session.id))).toMatchObject([
        { content: 'Par', status: 'partial', nodeId: 'output', executionId },
      ]);
      const execution = await readExecution(app, executionId);
      expect(execution.status).toBe('error');
      expect(execution.warnings).toContain('The turn was stopped by the user before it finished.');
      // Stopping again, or stopping a session with nothing running, is a no-op.
      expect((await app.inject(stopRequest(session.id))).statusCode).toBe(204);
      expect((await app.inject(stopRequest(randomUUID()))).statusCode).toBe(204);
    } finally {
      await app.close();
    }
  });

  it('aborts the turn when the client disconnects, and keeps what had streamed', async () => {
    let providerAborted = false;
    const provider = useProvider(async (_request, { onToken, signal }) => {
      onToken('Dis');
      await new Promise<never>((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            providerAborted = true;
            reject(new Error('upstream aborted'));
          },
          { once: true },
        ),
      );
      throw new Error('unreachable');
    });
    const { app, session } = await setup((presetId) => ({
      nodes: [node('input', 'chat-input'), llmNode('llm', presetId, provider), node('output', 'chat-output')],
      edges: [edge('llm', 'text', 'output', 'value')],
    }));
    try {
      await app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = app.server.address() as AddressInfo;
      const client = new AbortController();
      const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${session.id}/messages/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'hi' }),
        signal: client.signal,
      });
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const frames = readFrames(response.body!);
      const start = await nextFrameOfType(frames, 'turn.start');
      await nextFrameOfType(frames, 'node.delta');
      client.abort();
      const executionId = (start.data as unknown as { executionId: string }).executionId;
      await waitFor(async () => {
        const rows = assistantRows(await readSession(app, session.id));
        return rows.find((message) => message.content === 'Dis' && message.status === 'partial');
      });
      expect(providerAborted).toBe(true);
      const execution = await readExecution(app, executionId);
      expect(execution.status).toBe('error');
      expect(execution.warnings).toContain('The turn ended because the client disconnected before it finished.');
    } finally {
      await app.close();
    }
  });

  it('keeps streamed text as a partial row when the engine fails, and reports the failure', async () => {
    const provider = useProvider(async (_request, { onToken }) => {
      onToken('Oops');
      throw new Error('upstream exploded');
    });
    const { app, session } = await setup((presetId) => ({
      nodes: [node('input', 'chat-input'), llmNode('llm', presetId, provider), node('output', 'chat-output')],
      edges: [edge('llm', 'text', 'output', 'value')],
    }));
    try {
      const response = await app.inject(streamRequest(session.id, 'hi'));
      const frames = framesOf(response.body);
      expect(frames.at(-1)!.data).toMatchObject({
        type: 'turn.error',
        error: {
          code: 'WORKFLOW_EXECUTION_FAILED',
          message: expect.stringContaining('upstream exploded'),
          details: { assistantMessages: [{ content: 'Oops', status: 'partial' }] },
        },
      });
      expect(assistantRows(await readSession(app, session.id))).toMatchObject([{ content: 'Oops', status: 'partial' }]);
    } finally {
      await app.close();
    }
  });

  it('later turns read history without partial or streaming rows', async () => {
    let mode: 'hang' | 'done' = 'hang';
    const provider = useProvider(async (_request, { onToken, signal }) => {
      if (mode === 'done') {
        onToken('Done');
        return { text: 'Done', raw: {} };
      }
      onToken('PARTIAL-TOKENS');
      await new Promise<never>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }),
      );
      throw new Error('unreachable');
    });
    const { app, session } = await setup((presetId) => ({
      nodes: [
        llmNode('llm', presetId, provider),
        node('input', 'chat-input'),
        node('memory', 'memory', { lastN: 10, format: 'text' }),
        node('reply', 'chat-output'),
        node('transcript', 'chat-output'),
      ],
      edges: [edge('llm', 'text', 'reply', 'value'), edge('memory', 'history', 'transcript', 'value')],
    }));
    try {
      const turn = app.inject(streamRequest(session.id, 'first'));
      await waitFor(async () =>
        assistantRows(await readSession(app, session.id)).find((message) => message.content === 'PARTIAL-TOKENS'),
      );
      await app.inject(stopRequest(session.id));
      await turn;
      mode = 'done';
      const second = await app.inject({
        method: 'POST',
        url: `/api/sessions/${session.id}/messages`,
        payload: { content: 'second' },
      });
      const transcript = (second.json().assistantMessages as ChatMessage[]).find((message) =>
        message.content.includes('user: first'),
      );
      expect(transcript?.content).toContain('user: first');
      expect(transcript?.content).not.toContain('PARTIAL-TOKENS');
    } finally {
      await app.close();
    }
  });

  it('answers before the turn starts with plain JSON errors', async () => {
    const { app, session } = await setup((_presetId) => ({
      nodes: [node('input', 'chat-input'), node('output', 'chat-output')],
      edges: [edge('input', 'message', 'output', 'value')],
    }));
    try {
      const missing = await app.inject(streamRequest(randomUUID(), 'hi'));
      expect(missing.statusCode).toBe(404);
      expect(missing.headers['content-type']).toContain('application/json');
      expect(missing.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
      const malformed = await app.inject({ ...streamRequest(session.id, ''), payload: { content: 42 } });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json().error.code).toBe('VALIDATION_ERROR');
      expect((await app.inject(stopRequest('not-a-uuid'))).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('finalizing a turn', () => {
  const user: ChatMessage = { id: 'user-1', role: 'user', content: 'hi', createdAt: '2024-01-01T00:00:00.000Z' };
  const session = (messages: ChatMessage[]): Session => ({
    id: 'session',
    title: 'Chat',
    workflowId: 'workflow',
    messages,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  });
  const streamed = {
    id: 'row-1',
    outputId: 'output',
    createdAt: '2024-01-01T00:00:01.000Z',
    content: 'Hel',
    reasoning: 'think',
    name: 'Ann',
  };

  it('promotes a streamed row in place when its output ran', () => {
    const current = session([structuredClone(user)]);
    const userMessage = structuredClone(user);
    const settled = settleTurn(current, {
      executionId: 'execution',
      userMessage,
      replies: [{ nodeId: 'output', content: 'Hello', name: 'Ann' }],
      streamed: [streamed],
      interrupted: false,
    });
    expect(settled.assistantMessages).toEqual([
      {
        id: 'row-1',
        role: 'assistant',
        content: 'Hello',
        name: 'Ann',
        createdAt: '2024-01-01T00:00:01.000Z',
        executionId: 'execution',
        nodeId: 'output',
        status: 'final',
        reasoning: 'think',
      },
    ]);
    expect(current.messages).toEqual([{ ...user, executionId: 'execution' }, settled.assistantMessages[0]]);
    expect(current.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
  });

  it('drops a streamed row whose output did not run in a completed turn', () => {
    const current = session([structuredClone(user)]);
    const settled = settleTurn(current, {
      executionId: 'execution',
      userMessage: structuredClone(user),
      replies: [],
      streamed: [streamed],
      interrupted: false,
    });
    expect(settled.assistantMessages).toEqual([]);
    expect(current.messages.map((message) => message.id)).toEqual(['user-1']);
  });

  it('keeps streamed rows without a reply as partial when the turn was interrupted', () => {
    const current = session([structuredClone(user)]);
    const settled = settleTurn(current, {
      executionId: 'execution',
      userMessage: structuredClone(user),
      replies: [],
      streamed: [streamed],
      interrupted: true,
    });
    expect(settled.assistantMessages).toEqual([
      {
        id: 'row-1',
        role: 'assistant',
        content: 'Hel',
        name: 'Ann',
        createdAt: '2024-01-01T00:00:01.000Z',
        executionId: 'execution',
        nodeId: 'output',
        status: 'partial',
        reasoning: 'think',
      },
    ]);
    expect(current.messages.map((message) => message.id)).toEqual(['user-1', 'row-1']);
  });

  it('keeps a reply that completed before an interruption and marks the rest partial', () => {
    const current = session([structuredClone(user)]);
    const other = { ...streamed, id: 'row-2', outputId: 'other', content: 'Still going', reasoning: '' };
    const settled = settleTurn(current, {
      executionId: 'execution',
      userMessage: structuredClone(user),
      replies: [{ nodeId: 'output', content: 'Hello' }],
      streamed: [streamed, other],
      interrupted: true,
    });
    expect(settled.assistantMessages.map(({ id, content, status }) => [id, content, status])).toEqual([
      ['row-1', 'Hello', 'final'],
      ['row-2', 'Still going', 'partial'],
    ]);
  });

  it('writes non-streamed replies exactly as before, with no status or node id', () => {
    const current = session([structuredClone(user)]);
    const settled = settleTurn(current, {
      executionId: 'execution',
      userMessage: structuredClone(user),
      replies: [{ nodeId: 'plain', content: 'Plain reply' }],
      streamed: [],
      interrupted: false,
    });
    expect(settled.assistantMessages).toHaveLength(1);
    expect(settled.assistantMessages[0]).toMatchObject({ role: 'assistant', content: 'Plain reply' });
    expect(settled.assistantMessages[0]).not.toHaveProperty('status');
    expect(settled.assistantMessages[0]).not.toHaveProperty('nodeId');
  });
});

describe('history', () => {
  it('leaves out streaming and partial assistant rows, and keeps final and unstamped ones', () => {
    const base = { createdAt: '', executionId: 'execution' };
    const messages: ChatMessage[] = [
      { id: 'user', role: 'user', content: 'hi', ...base },
      { id: 'legacy', role: 'assistant', content: 'legacy reply', ...base },
      { id: 'final', role: 'assistant', content: 'final reply', status: 'final', ...base },
      { id: 'partial', role: 'assistant', content: 'cut off', status: 'partial', ...base },
      { id: 'streaming', role: 'assistant', content: 'in progress', status: 'streaming', ...base },
    ];
    expect(historyMessages(messages).map((message) => message.id)).toEqual(['user', 'legacy', 'final']);
  });
});
