import { afterEach, expect, it } from 'vitest';
import { apiContract, type ToolCall } from '@st/shared';
import { chatResponse, restoreAdapter, useAdapter } from './test-support/adapter.js';
import {
  assistantRows,
  define,
  edge,
  entriesOf,
  makeSession,
  makeWorkflow,
  node,
  readSession,
  tempApps,
  turn,
  type App,
} from './test-support/story.js';

// A thread key in a real turn: an LLM node's exchange stored by State Write, the size of the state view, and the turn
// rules (deleting the reply undoes the exchange).

const apps = tempApps('thread-keys');
afterEach(async () => {
  restoreAdapter();
  await apps.cleanup();
});

const readsState = () => {
  const tool_calls: ToolCall[] = [
    { id: 'call_1', type: 'function', function: { name: 'read_state', arguments: '{"keys":["story.mood"]}' } },
  ];
  return chatResponse('', { message: { role: 'assistant', content: '', reasoning: 'let me look', tool_calls } });
};

async function threadChat(app: App) {
  await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
  const definition = await define(app, {
    name: 'story',
    keys: { mood: { type: 'text', default: 'calm' }, thread: { type: 'thread', cap: 5 } },
  });
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
        tools: { read: [{ definitionId: definition.id, key: 'mood' }] },
      }),
      node('keep', 'state-write', { definitionId: definition.id, key: 'thread', op: 'add' }),
      node('output', 'chat-output'),
    ],
    [
      edge('llm', 'text', 'output', 'value'),
      edge('llm', 'exchange', 'keep', 'value'),
      edge('input', 'message', 'keep', 'input'),
    ],
  );
  return { definition, session: await makeSession(app, workflow.id) };
}

const stateView = async (app: App, sessionId: string) => {
  const response = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/state` });
  expect(response.statusCode).toBe(200);
  return { body: response.body, view: apiContract.getSessionState.response.parse(response.json()) };
};

it('stores the exchange on the turn, keeps the state view small, and undoes it with the reply', async () => {
  let calls = 0;
  const script = [readsState(), chatResponse('It is calm.')];
  useAdapter({ chat: async () => script[calls++ % script.length]! });
  const { app } = await apps.open();
  try {
    const { definition, session } = await threadChat(app);
    expect(await turn(app, session.id, 'How is it?')).toEqual(['It is calm.']);

    // Stored: the whole exchange without reasoning, the user input, and the engine's stamps.
    const stored = await readSession(app, session.id);
    const [entry] = entriesOf(stored);
    const write = entry?.writes[0];
    expect(write).toMatchObject({ op: 'add', target: { definitionId: definition.id, key: 'thread' }, nodeId: 'keep' });
    const item = (write as { item: Record<string, unknown> }).item;
    expect(item).toMatchObject({
      text: 'It is calm.',
      turnId: entry?.executionId,
      runId: entry?.runs?.[0]?.executionId,
      input: { role: 'user', content: 'How is it?' },
    });
    const exchange = item.exchange as { role: string; reasoning?: string; tool_calls?: unknown[] }[];
    expect(exchange.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(exchange.some((message) => 'reasoning' in message)).toBe(false);
    expect(exchange[0]?.tool_calls).toHaveLength(1);

    // The view: a summary of the item, in the value and in the turn's write, never the exchange.
    const { body, view } = await stateView(app, session.id);
    expect(body).not.toContain('tool_call_id');
    expect(body).not.toContain('"exchange"');
    const summary = { id: item.id, text: 'It is calm.', steps: 2, toolCalls: ['read_state'] };
    expect(view.definitions[0]?.values.thread).toEqual([expect.objectContaining(summary)]);
    expect(view.definitions[0]?.meta.thread).toMatchObject({ written: true, count: 1 });
    expect(view.turns[0]?.writes[0]?.write).toMatchObject({ op: 'add', item: expect.objectContaining(summary) });

    // Deleting the reply: the turn no longer counts, so the exchange is gone from the state.
    const reply = assistantRows(stored)[0]!;
    const deleted = await app.inject({ method: 'DELETE', url: `/api/sessions/${session.id}/messages/${reply.id}` });
    expect(deleted.statusCode).toBeLessThan(300);
    const after = await stateView(app, session.id);
    expect(after.view.definitions[0]?.values.thread).toEqual([]);
    expect(after.view.turns[0]).toMatchObject({ turnNumber: null });
  } finally {
    await app.close();
  }
});
