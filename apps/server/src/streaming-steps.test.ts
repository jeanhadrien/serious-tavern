import { afterEach, expect, it } from 'vitest';
import { turnEventSchema, type ToolCall } from '@st/shared';
import type { ChatResponse, StreamOptions } from '@st/engine';
import { chatResponse, restoreAdapter, useAdapter } from './test-support/adapter.js';
import { parseEventStream } from './test-support/event-stream.js';
import {
  assistantRows,
  define,
  edge,
  makeSession,
  makeWorkflow,
  node,
  readSession,
  tempApps,
  type App,
} from './test-support/story.js';

// A tool-using LLM streams every step, but only the last step's text is the answer: the chat clears the text when a
// step starts, stored rows (partial ones too) hold the last step's text, and the reasoning keeps every step's.

const apps = tempApps('streaming-steps');
afterEach(async () => {
  restoreAdapter();
  await apps.cleanup();
});

const STEP_ONE_TEXT = 'Let me check';
const callsTool = (): ChatResponse => {
  const tool_calls: ToolCall[] = [
    {
      id: 'call_1',
      type: 'function',
      function: { name: 'write_counter_n', arguments: JSON.stringify({ op: 'set', value: 2 }) },
    },
  ];
  return chatResponse('', { message: { role: 'assistant', content: '', tool_calls } });
};

/** Step 1 reasons, says something and calls a tool; `second` is step 2. */
async function setup(second: (options: StreamOptions) => Promise<ChatResponse>) {
  let calls = 0;
  useAdapter({
    chat: async () => {
      throw new Error('These tests stream');
    },
    stream: async (_request, options) => {
      if (++calls > 1) return second(options);
      options.onReasoning('think 1');
      options.onToken(STEP_ONE_TEXT);
      return callsTool();
    },
  });
  const { app } = await apps.open();
  await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
  const definition = await define(app);
  const preset = (
    await app.inject({ method: 'POST', url: '/api/presets', payload: { name: 'P', inputs: [], entries: [] } })
  ).json();
  const workflow = await makeWorkflow(
    app,
    [
      node('input', 'chat-input'),
      node('llm', 'llm', {
        presetId: preset.id,
        provider: 'openrouter',
        model: 'm',
        tools: { read: [], write: [{ definitionId: definition.id, key: 'n' }] },
      }),
      node('output', 'chat-output'),
    ],
    [edge('llm', 'text', 'output', 'value')],
  );
  return { app, session: await makeSession(app, workflow.id) };
}

const streamTurn = (app: App, sessionId: string) =>
  app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/messages/stream`, payload: { content: 'go' } });
const framesOf = (body: string) => parseEventStream(body).map((frame) => turnEventSchema.parse(frame.data));

async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for the condition');
}

it('clears the streamed text when a step starts and keeps every step’s reasoning, on a completed turn', async () => {
  const { app, session } = await setup(async ({ onReasoning, onToken }) => {
    onReasoning('think 2');
    onToken('Final');
    return chatResponse('Final');
  });
  try {
    const response = await streamTurn(app, session.id);
    const frames = framesOf(response.body);
    // What the client shows is the frames applied in order, as the web's `applyDelta` does.
    let text = '';
    let reasoning = '';
    for (const frame of frames) {
      if (frame.type !== 'node.delta') continue;
      text = (frame.reset ? '' : text) + (frame.textDelta ?? '');
      reasoning += frame.reasoningDelta ?? '';
    }
    expect(frames.some((frame) => frame.type === 'node.delta' && frame.reset)).toBe(true);
    expect(text).toBe('Final');
    expect(reasoning).toBe('think 1\n\nthink 2');
    expect(assistantRows(await readSession(app, session.id))).toMatchObject([
      { content: 'Final', status: 'final', reasoning: 'think 1\n\nthink 2' },
    ]);
  } finally {
    await app.close();
  }
});

it('keeps only the last step’s text in the partial row of a stopped turn, and all the reasoning', async () => {
  const { app, session } = await setup(async ({ onReasoning, onToken, signal }) => {
    onReasoning('think 2');
    onToken('Par');
    await new Promise<never>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('upstream aborted')), { once: true }),
    );
    throw new Error('unreachable');
  });
  try {
    const turn = streamTurn(app, session.id);
    // The row held step 1's text first; it holds step 2's alone once the step started.
    await waitFor(async () =>
      assistantRows(await readSession(app, session.id)).find((message) => message.content === 'Par'),
    );
    await app.inject({ method: 'POST', url: `/api/sessions/${session.id}/stop` });
    const frames = framesOf((await turn).body);
    expect(frames.some((frame) => frame.type === 'node.delta' && frame.reset)).toBe(true);
    expect(frames.at(-1)).toMatchObject({
      type: 'turn.error',
      error: {
        code: 'TURN_STOPPED',
        details: { assistantMessages: [{ content: 'Par', status: 'partial', reasoning: 'think 1\n\nthink 2' }] },
      },
    });
    expect(assistantRows(await readSession(app, session.id))).toMatchObject([
      { content: 'Par', status: 'partial', reasoning: 'think 1\n\nthink 2' },
    ]);
  } finally {
    await app.close();
  }
});

it('keeps only the last step’s text in the partial row of a failed turn', async () => {
  const { app, session } = await setup(async ({ onToken }) => {
    onToken('Oops');
    throw new Error('upstream exploded');
  });
  try {
    const frames = framesOf((await streamTurn(app, session.id)).body);
    expect(frames.at(-1)).toMatchObject({
      type: 'turn.error',
      error: { details: { assistantMessages: [{ content: 'Oops', status: 'partial' }] } },
    });
    // No second step reasoned, so the reasoning is step 1's alone, without a dangling separator.
    expect(assistantRows(await readSession(app, session.id))).toMatchObject([
      { content: 'Oops', status: 'partial', reasoning: 'think 1' },
    ]);
  } finally {
    await app.close();
  }
});
