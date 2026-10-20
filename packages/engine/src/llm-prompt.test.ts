import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptMessage } from '@st/shared';
import { llm } from './nodes/llm/index.js';
import * as presetModule from './preset.js';
import { chatResponse, restoreAdapter, useAdapter } from './test-providers.js';
import { callsReply, prompt, resources, scriptedModel, target, toolContext } from './tools/test-tools.js';
import type { ExecutionContext } from './types.js';

// What the LLM node does to the rendered prompt before the call (replay, flattening, repair). The rendered prompt
// is faked here; how slots render messages is preset.test.ts.

vi.mock('./preset.js', { spy: true });
afterEach(() => {
  restoreAdapter();
  vi.restoreAllMocks();
});

const own = { providerId: 'fake', model: 'm', nodeId: 'x' };
const thought = (content: string): PromptMessage => ({
  role: 'assistant',
  content,
  reasoning: 'why',
  provider_data: { reasoning_details: [1] },
  provenance: own,
});

/**
 * Runs the node on a hand-built context whose preset renders to `rendered` (or, without it, really renders from
 * `inputs`); returns what the model got.
 */
async function sent(config: Record<string, unknown>, rendered?: PromptMessage[], inputs: Record<string, unknown> = {}) {
  const actual = await vi.importActual<typeof presetModule>('./preset.js');
  vi.spyOn(presetModule, 'renderPreset').mockImplementation(rendered ? () => rendered : actual.renderPreset);
  const model = scriptedModel(chatResponse('ok'));
  useAdapter(model.adapter);
  const logs: string[] = [];
  const ctx: ExecutionContext = {
    ...toolContext().ctx,
    nodeId: 'llm',
    config: { ...llm.defaultConfig, presetId: prompt.id, provider: 'fake', model: 'm', ...config },
    inputs,
    trigger: { message: '', sessionId: 's' },
    settings: {},
    history: [],
    secrets: { get: async () => 'key' },
    resources,
    signal: new AbortController().signal,
    log: (line) => logs.push(line),
    random: () => 0,
    recordWire: () => {},
    beginWire: () => {},
    emit: () => {},
  };
  await llm.execute(ctx);
  return { messages: model.requests[0]!.messages, logs };
}
const kept = (messages: PromptMessage[]) => messages.map((message) => message.reasoning !== undefined);

describe('the prompt before the call', () => {
  const chat: PromptMessage[] = [thought('old'), { role: 'user', content: 'hi' }, thought('new')];

  it('does not replay reasoning by default', async () => {
    expect(kept((await sent({}, chat)).messages)).toEqual([false, false, false]);
  });

  it('replays by the node’s policy, for messages the same provider and model wrote', async () => {
    expect(kept((await sent({ replayReasoning: 'always' }, chat)).messages)).toEqual([true, false, true]);
    expect(kept((await sent({ replayReasoning: 'sinceLastUser' }, chat)).messages)).toEqual([false, false, true]);
    expect(kept((await sent({ replayReasoning: 'always', model: 'other' }, chat)).messages)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('sends a stored chat history with only the canonical message fields', async () => {
    const stored = [
      { id: 'm1', role: 'user', content: 'hi', executionId: 'e', status: 'done', characterId: 'c', createdAt: '' },
      { id: 'm2', role: 'assistant', content: 'yo', runId: 'r', editedAt: 't', name: 'Mira' },
    ];
    const { messages } = await sent({}, undefined, { history: stored });
    expect(messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'yo', name: 'Mira' },
    ]);
  });

  it('repairs a tool sequence nobody answered and says so', async () => {
    const { messages, logs } = await sent({}, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
      { role: 'tool', tool_call_id: 'lost', content: '1' },
    ]);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(logs).toEqual(['Left out 1 tool message(s) or call(s) that had no counterpart in the prompt']);
  });

  describe('tool blocks of tools the node does not declare', () => {
    const exchange = (name: string): PromptMessage[] => [
      {
        ...callsReply([name, { keys: ['a'] }]).message,
        content: 'Looking',
        reasoning: 'why',
        provider_data: { x: 1 },
        provenance: own,
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"a":1}' },
    ];
    const history: PromptMessage[] = [
      { role: 'user', content: 'hi' },
      ...exchange('lookup'),
      { role: 'user', content: 'go' },
    ];

    it('sends them as text when the node declares no tools, and says so', async () => {
      const { messages, logs } = await sent({ replayReasoning: 'always' }, history);
      expect(messages).toEqual([
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: 'Looking\nassistant -> lookup({"keys":["a"]})',
          reasoning: 'why',
          provenance: own,
        },
        { role: 'user', content: 'tool lookup: {"a":1}' },
        { role: 'user', content: 'go' },
      ]);
      expect(logs).toEqual(['1 tool call(s) of undeclared tools sent as text']);
    });

    it('keeps blocks of declared tools native and flattens the rest', async () => {
      const { messages, logs } = await sent({ tools: { read: [target('tension')], write: [] } }, [
        ...exchange('read_state'),
        ...exchange('lookup'),
      ]);
      expect(messages.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant', 'user']);
      expect(messages[0]?.tool_calls).toHaveLength(1);
      expect(messages[2]?.tool_calls).toBeUndefined();
      expect(logs).toEqual(['1 tool call(s) of undeclared tools sent as text']);
    });
  });

  it('repairs after merging and replaying, and still merges system messages', async () => {
    const { messages, logs } = await sent({ mergeSystemMessages: true }, [
      { role: 'system', content: 'One' },
      { role: 'system', content: 'Two' },
      thought('a'),
    ]);
    expect(messages).toEqual([
      { role: 'system', content: 'One\n\nTwo' },
      { role: 'assistant', content: 'a', provenance: own },
    ]);
    expect(logs).toEqual([]);
  });
});
