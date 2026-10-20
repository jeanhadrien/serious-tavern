import { afterEach, expect, it } from 'vitest';
import type { ChatRequest } from '@st/engine';
import type { ToolCall } from '@st/shared';
import { chatResponse, restoreAdapter, useAdapter } from './test-support/adapter.js';
import {
  assistantRows,
  define,
  edge,
  entriesOf,
  makeSession,
  makeWorkflow,
  node,
  tempApps,
  turn,
} from './test-support/story.js';
import { readSession } from './test-support/story.js';

// An LLM node that calls state tools in a real turn: its writes are stored on the turn like State Write's, and a
// later step reads them back through the server's fold.

const apps = tempApps('llm-tools');
afterEach(async () => {
  restoreAdapter();
  await apps.cleanup();
});

const callsTool = (name: string, args: object) => {
  const tool_calls: ToolCall[] = [
    { id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
  ];
  return chatResponse('', { message: { role: 'assistant', content: '', tool_calls } });
};

it('stores the writes of a tool-using LLM node on the turn and lets it read them back', async () => {
  const requests: ChatRequest[] = [];
  const script = [
    callsTool('write_counter_n', { op: 'increment', value: 2 }),
    callsTool('read_state', { keys: ['counter.n'] }),
    chatResponse('The count is two.'),
  ];
  useAdapter({
    chat: async (request) => {
      requests.push(structuredClone(request));
      return script[requests.length - 1]!;
    },
  });
  const { app } = await apps.open();
  try {
    await app.inject({ method: 'PUT', url: '/api/secrets/openrouter', payload: { value: 'test-key' } });
    const definition = await define(app);
    const preset = (
      await app.inject({ method: 'POST', url: '/api/presets', payload: { name: 'P', inputs: [], entries: [] } })
    ).json();
    const key = { definitionId: definition.id, key: 'n' };
    const workflow = await makeWorkflow(
      app,
      [
        node('input', 'chat-input'),
        node('llm', 'llm', {
          presetId: preset.id,
          provider: 'openrouter',
          model: 'm',
          tools: { read: [key], write: [key] },
        }),
        node('output', 'chat-output'),
      ],
      [edge('llm', 'text', 'output', 'value')],
    );
    const session = await makeSession(app, workflow.id);

    expect(await turn(app, session.id)).toEqual(['The count is two.']);

    expect(requests).toHaveLength(3);
    expect(requests[0]?.tools?.map((tool) => tool.function.name)).toEqual(['read_state', 'write_counter_n']);
    // The write of step 1 is visible to the read of step 2, through the server's fold.
    const readResult = requests[2]!.messages.at(-1)!;
    expect(readResult).toMatchObject({ role: 'tool', tool_call_id: 'call_read_state' });
    expect(JSON.parse(readResult.content)).toEqual({ 'counter.n': 2 });

    // The write is stored on the turn, as State Write's would be, and the reply holds the last step's text.
    const stored = await readSession(app, session.id);
    expect(assistantRows(stored).map((message) => message.content)).toEqual(['The count is two.']);
    const [entry] = entriesOf(stored);
    expect(entry?.writes).toEqual([
      { op: 'set', target: { kind: 'definition', definitionId: definition.id, key: 'n' }, nodeId: 'llm', value: 2 },
    ]);
  } finally {
    await app.close();
  }
});
