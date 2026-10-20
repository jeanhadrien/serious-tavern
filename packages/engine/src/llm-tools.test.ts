import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptMessage } from '@st/shared';
import { ExecutionFailure, executeWorkflow } from './executor.js';
import { llm } from './nodes/llm/index.js';
import { applyReplayPolicy } from './nodes/llm/replay.js';
import { chatResponse, restoreAdapter, useAdapter } from './test-providers.js';
import { callsReply, llmWorkflow, prompt, runOptions, scriptedModel, target } from './tools/test-tools.js';
import type { EngineEvent } from './types.js';

// The LLM node with tools, through the executor: the loop, the exchange output and the state it writes.

afterEach(restoreAdapter);

const tools = { read: [target('tension'), target('log')], write: [target('tension'), target('log')] };

async function run(config: Record<string, unknown>, ...script: Parameters<typeof scriptedModel>) {
  const model = scriptedModel(...script);
  useAdapter(model.adapter);
  const result = await executeWorkflow(llmWorkflow(config), runOptions);
  const log = result.execution.nodes.llm!;
  return { ...model, ...result, log, output: log.output as Record<string, any> };
}

describe('an LLM node without tools', () => {
  it('makes one call that mentions no tools and outputs the exchange', async () => {
    const { requests, output, log, replies } = await run({}, chatResponse('Hello', { raw: { id: 1 } }));
    expect(requests).toHaveLength(1);
    for (const field of ['tools', 'toolChoice', 'parallelToolCalls']) expect(requests[0]).not.toHaveProperty(field);
    expect(output.text).toBe('Hello');
    expect(output.raw).toEqual({ id: 1 });
    expect(output.exchange).toEqual([{ role: 'assistant', content: 'Hello' }]);
    expect(log.wires).toHaveLength(1);
    expect(log.logs).toBeUndefined();
    expect(replies.map((reply) => reply.content)).toEqual(['Hello']);
  });

  it('reads an old config without the new settings', () => {
    const parsed = llm.configSchema.parse({ presetId: prompt.id });
    expect(parsed).toMatchObject({
      tools: { read: [], write: [] },
      maxSteps: 5,
      toolChoice: 'auto',
      replayReasoning: 'never',
    });
    expect(parsed.parallelToolCalls).toBeUndefined();
    expect(llm.configSchema.safeParse({ presetId: prompt.id, maxSteps: 0 }).success).toBe(false);
    expect(llm.configSchema.safeParse({ presetId: prompt.id, toolChoice: 'none' }).success).toBe(false);
  });

  it('declares the exchange output', () => {
    expect(llm.outputs.find((port) => port.name === 'exchange')).toMatchObject({ dataType: 'messages' });
  });
});

describe('an LLM node with state tools', () => {
  it('runs the model’s tool calls and stores their writes on the turn', async () => {
    const { requests, output, log, writes, replies } = await run(
      { tools },
      callsReply(
        ['write_scene_tension', { op: 'increment', value: 2 }],
        ['write_scene_log', { op: 'add', text: 'A storm' }],
      ),
      chatResponse('The storm breaks.', { raw: { last: true } }),
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]?.tools?.map((tool) => tool.function.name)).toEqual([
      'read_state',
      'write_scene_tension',
      'write_scene_log',
    ]);
    // The answer is the last step's; the raw response too.
    expect(output.text).toBe('The storm breaks.');
    expect(output.raw).toEqual({ last: true });
    expect(replies.map((reply) => reply.content)).toEqual(['The storm breaks.']);
    expect(output.exchange.map((message: PromptMessage) => message.role)).toEqual([
      'assistant',
      'tool',
      'tool',
      'assistant',
    ]);
    expect(JSON.parse(output.exchange[1].content)).toBe(5);
    expect(JSON.parse(output.exchange[2].content)).toEqual([{ handle: '#1', text: 'A storm' }]);
    // One wire entry per call, one log line per tool call.
    expect(log.wires).toHaveLength(2);
    expect(log.logs?.filter((line) => line.startsWith('step 1:'))).toEqual([
      'step 1: write_scene_tension {"op":"increment","value":2} -> ok',
      'step 1: write_scene_log {"op":"add","text":"A storm"} -> ok',
    ]);
    // The same stored writes a State Write node would make.
    expect(writes.map((write) => write.op)).toEqual(['set', 'add']);
    expect(writes[0]).toMatchObject({ nodeId: 'llm', value: 5 });
    expect(writes[1]).toMatchObject({ nodeId: 'llm', item: { text: 'A storm' } });
  });

  it('reads its own write in the next step, and sends the model’s earlier messages back whole', async () => {
    const withReasoning = callsReply(['write_scene_tension', { op: 'set', value: 8 }]);
    withReasoning.message = {
      ...withReasoning.message,
      reasoning: 'I should raise it.',
      provider_data: { reasoning_details: [{ n: 1 }] },
      provenance: { providerId: 'other', model: 'other-model', nodeId: 'llm' },
    };
    const { requests, output } = await run(
      { tools },
      withReasoning,
      callsReply(['read_state', { keys: ['scene.tension'] }]),
      chatResponse('Done.'),
    );
    expect(JSON.parse(output.exchange[3].content)).toEqual({ 'scene.tension': 8 });
    // Inside the loop nothing is stripped, whatever replay policy and provenance say.
    expect(requests[1]?.messages.at(-2)).toMatchObject({
      reasoning: 'I should raise it.',
      provider_data: { reasoning_details: [{ n: 1 }] },
    });
  });

  it('answers a bad call with an error and goes on', async () => {
    const { output } = await run(
      { tools },
      callsReply(['write_scene_tension', { op: 'set', value: 'high' }]),
      chatResponse('Sorry.'),
    );
    expect(JSON.parse(output.exchange[1].content)).toEqual({ error: 'scene.tension needs a number, got text' });
    expect(output.text).toBe('Sorry.');
  });

  it('stops using tools at the step limit', async () => {
    const { requests, log } = await run(
      { tools, maxSteps: 2 },
      callsReply(['read_state', { keys: ['scene.tension'] }]),
      callsReply(['read_state', { keys: ['scene.tension'] }]),
      chatResponse('Enough.'),
    );
    expect(requests.map((request) => request.toolChoice)).toEqual(['auto', 'auto', 'none']);
    expect(log.logs).toContain('Step limit (2) reached: asking for a final answer without tool use');
    expect(log.wires).toHaveLength(3);
  });

  it('passes toolChoice and parallelToolCalls on', async () => {
    const { requests } = await run(
      { tools, toolChoice: 'required', parallelToolCalls: false },
      callsReply(['read_state', { keys: ['scene.tension'] }]),
      chatResponse('ok'),
    );
    expect(requests.map((request) => request.toolChoice)).toEqual(['required', 'auto']);
    expect(requests[0]?.parallelToolCalls).toBe(false);
  });

  it('leaves out listed keys that no longer exist and says so', async () => {
    const { requests, log } = await run({ tools: { read: [], write: [target('gone')] } }, chatResponse('ok'));
    expect(requests[0]).not.toHaveProperty('tools');
    expect(log.logs?.[0]).toContain('Left out a write tool');
  });

  it('stores nothing when the node fails after writing', async () => {
    const model = scriptedModel(callsReply(['write_scene_tension', { op: 'set', value: 8 }]));
    useAdapter(model.adapter);
    // The second call has no scripted answer: the model call fails.
    const failure = await executeWorkflow(llmWorkflow({ tools }), runOptions).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ExecutionFailure);
    expect((failure as ExecutionFailure).writes).toEqual([]);
    expect((failure as ExecutionFailure).execution.nodes.llm?.status).toBe('error');
  });

  it('streams every step’s text and reasoning, with a stepStart before each step after the first', async () => {
    const stream = vi.fn(async (_request, { onToken, onReasoning }) => {
      onReasoning('r');
      onToken('t');
      return stream.mock.calls.length === 1
        ? callsReply(['read_state', { keys: ['scene.tension'] }])
        : chatResponse('t');
    });
    useAdapter({ chat: vi.fn(), stream });
    const events: EngineEvent[] = [];
    await executeWorkflow(llmWorkflow({ tools }), { ...runOptions, onEvent: (event) => events.push(event) });
    const details = events.filter((event) => event.type === 'node:delta').map((event) => event.detail);
    expect(details).toEqual([
      { reasoningDelta: 'r' },
      { textDelta: 't' },
      { stepStart: true },
      { reasoningDelta: 'r' },
      { textDelta: 't' },
    ]);
  });

  it('emits a whole reasoning trace once per step when not streaming', async () => {
    const first = callsReply(['read_state', { keys: ['scene.tension'] }]);
    first.reasoning = 'one';
    useAdapter(scriptedModel(first, chatResponse('ok', { reasoning: 'two' })).adapter);
    const events: EngineEvent[] = [];
    await executeWorkflow(llmWorkflow({ tools, streaming: false }), {
      ...runOptions,
      onEvent: (event) => events.push(event),
    });
    expect(events.filter((event) => event.type === 'node:delta').map((event) => event.detail)).toEqual([
      { reasoningDelta: 'one' },
      { stepStart: true },
      { reasoningDelta: 'two' },
    ]);
  });
});

describe('the prompt before the call', () => {
  const current = { providerId: 'fake', model: 'm' };
  const own = { providerId: 'fake', model: 'm', nodeId: 'x' };
  const thought = (extra: Partial<PromptMessage> = {}): PromptMessage => ({
    role: 'assistant',
    content: 'a',
    reasoning: 'why',
    provider_data: { reasoning_details: [1] },
    provenance: own,
    ...extra,
  });
  const chat: PromptMessage[] = [
    thought({ content: 'old' }),
    { role: 'user', content: 'hi' },
    thought({ content: 'new' }),
  ];
  const kept = (messages: PromptMessage[]) => messages.map((message) => message.reasoning !== undefined);

  it('never replays by default', () => {
    expect(kept(applyReplayPolicy(chat, 'never', current))).toEqual([false, false, false]);
  });

  it('replays what came after the last user message with sinceLastUser', () => {
    expect(kept(applyReplayPolicy(chat, 'sinceLastUser', current))).toEqual([false, false, true]);
  });

  it('replays every message of the same provider and model with always', () => {
    expect(kept(applyReplayPolicy(chat, 'always', current))).toEqual([true, false, true]);
  });

  it('strips provider_data with the reasoning, and only reasoning of messages that have it', () => {
    const [first] = applyReplayPolicy([thought()], 'never', current);
    expect(first).toEqual({ role: 'assistant', content: 'a', provenance: own });
    expect('reasoning' in (first as object)).toBe(false);
    const plain: PromptMessage = { role: 'user', content: 'u' };
    expect(applyReplayPolicy([plain], 'never', current)[0]).toBe(plain);
  });

  it.each([
    ['another model', { ...own, model: 'other' }],
    ['another provider record', { ...own, providerId: 'other' }],
  ])('never replays reasoning from %s', (_name, provenance) => {
    expect(kept(applyReplayPolicy([thought({ provenance })], 'always', current))).toEqual([false]);
  });

  it('never replays a message without provenance', () => {
    const { provenance: _, ...bare } = thought();
    expect(kept(applyReplayPolicy([bare], 'always', current))).toEqual([false]);
  });

  it('never changes the messages it is given', () => {
    const before = structuredClone(chat);
    applyReplayPolicy(chat, 'never', current);
    expect(chat).toEqual(before);
  });
});
