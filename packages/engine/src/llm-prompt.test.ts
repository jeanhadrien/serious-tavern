import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptMessage } from '@st/shared';
import { llm } from './nodes/llm/index.js';
import * as presetModule from './preset.js';
import { chatResponse, restoreAdapter, useAdapter } from './test-providers.js';
import { stateless } from './test-state.js';
import { callsReply, prompt, resources, scriptedModel } from './tools/test-tools.js';
import type { ExecutionContext } from './types.js';

// What the LLM node does to the rendered prompt before the call. Presets do not carry reasoning or tool messages
// yet, so the rendered prompt is faked here.

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

/** Runs the node on a hand-built context whose preset renders to `rendered`; returns what the model got. */
async function sent(config: Record<string, unknown>, rendered: PromptMessage[]) {
  vi.spyOn(presetModule, 'renderPreset').mockReturnValue(rendered);
  const model = scriptedModel(chatResponse('ok'));
  useAdapter(model.adapter);
  const logs: string[] = [];
  const ctx: ExecutionContext = {
    ...stateless('llm'),
    nodeId: 'llm',
    config: { ...llm.defaultConfig, presetId: prompt.id, provider: 'fake', model: 'm', ...config },
    inputs: {},
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

  it('repairs a tool sequence nobody answered and says so', async () => {
    const { messages, logs } = await sent({}, [
      { role: 'user', content: 'hi' },
      callsReply(['read_state', {}]).message,
      { role: 'tool', tool_call_id: 'lost', content: '1' },
    ]);
    expect(messages.map((message) => message.role)).toEqual(['user']);
    expect(logs).toEqual(['Left out 2 tool message(s) or call(s) that had no counterpart in the prompt']);
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
