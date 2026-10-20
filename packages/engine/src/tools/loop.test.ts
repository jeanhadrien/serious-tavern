import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@st/shared';
import type { ChatRequest, ChatResponse } from '../providers/index.js';
import { chatResponse } from '../test-providers.js';
import { runToolLoop } from './loop.js';
import { callsReply, toolContext } from './test-tools.js';
import type { EngineTool } from './types.js';

// The loop alone, against fake tools and a scripted `call`.

const echo: EngineTool = {
  definition: { type: 'function', function: { name: 'echo', description: 'Echoes', parameters: { type: 'object' } } },
  run: async (args) => ({ echoed: args }),
};
const failing: EngineTool = {
  definition: { type: 'function', function: { name: 'fail', parameters: { type: 'object' } } },
  run: async () => {
    throw new Error('It broke');
  },
};

const baseRequest: ChatRequest = {
  model: 'm',
  messages: [{ role: 'user', content: 'go' }],
  temperature: 0.7,
  maxTokens: 100,
};

/** Runs the loop against a scripted model; returns what it sent and got. */
async function run(
  script: ChatResponse[],
  options: {
    tools?: EngineTool[];
    maxSteps?: number;
    toolChoice?: 'auto' | 'required';
    parallelToolCalls?: boolean;
  } = {},
) {
  const { ctx, logs } = toolContext();
  const requests: ChatRequest[] = [];
  const beginWire = vi.spyOn(ctx, 'beginWire');
  const emit = vi.spyOn(ctx, 'emit');
  const result = await runToolLoop({
    request: baseRequest,
    call: async (request) => {
      requests.push(structuredClone(request));
      const next = script[requests.length - 1];
      if (!next) throw new Error('no more answers');
      return next;
    },
    tools: options.tools ?? [echo, failing],
    maxSteps: options.maxSteps ?? 5,
    toolChoice: options.toolChoice ?? 'auto',
    parallelToolCalls: options.parallelToolCalls,
    ctx,
  });
  return {
    ...result,
    requests,
    logs,
    wires: beginWire.mock.calls.length,
    events: emit.mock.calls.map(([event]) => event),
  };
}

const toolMessages = (exchange: ConversationMessage[]) => exchange.filter((message) => message.role === 'tool');
const contentOf = (message: ConversationMessage | undefined) => JSON.parse(message?.content ?? 'null');

describe('runToolLoop', () => {
  it('makes one call and sends nothing about tools when there are none', async () => {
    const { exchange, response, requests, wires } = await run([chatResponse('hello')], { tools: [] });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(baseRequest);
    expect(exchange).toEqual([{ role: 'assistant', content: 'hello' }]);
    expect(response.text).toBe('hello');
    expect(wires).toBe(1);
  });

  it('runs a tool call and calls the model again with the exchange so far', async () => {
    const { exchange, requests, logs, wires } = await run([callsReply(['echo', { a: 1 }]), chatResponse('done')]);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ toolChoice: 'auto', tools: [echo.definition, failing.definition] });
    expect(requests[1]?.messages).toEqual([baseRequest.messages[0], exchange[0], exchange[1]]);
    expect(exchange.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(exchange[1]).toMatchObject({ tool_call_id: 'call_1' });
    expect(contentOf(exchange[1])).toEqual({ echoed: { a: 1 } });
    expect(logs).toEqual(['step 1: echo {"a":1} -> ok']);
    expect(wires).toBe(2);
  });

  it('announces every step after the first, and nothing for a single call', async () => {
    const single = await run([chatResponse('hello')], { tools: [] });
    expect(single.events).toEqual([]);
    const looped = await run([callsReply(['echo', {}]), callsReply(['echo', {}]), chatResponse('done')]);
    const stepStart = { type: 'node:delta', nodeId: 'llm', detail: { stepStart: true } };
    expect(looped.events).toEqual([stepStart, stepStart]);
  });

  it('runs several calls of one step one after another, in the order sent', async () => {
    const order: string[] = [];
    const slow: EngineTool = {
      ...echo,
      run: async (args) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`slow ${JSON.stringify(args)}`);
        return 'slow';
      },
    };
    const quick: EngineTool = {
      definition: { type: 'function', function: { name: 'quick', parameters: { type: 'object' } } },
      run: async () => {
        order.push('quick');
        return 'quick';
      },
    };
    const { exchange } = await run([callsReply(['echo', { n: 1 }], ['quick', {}]), chatResponse('done')], {
      tools: [slow, quick],
    });
    expect(order).toEqual(['slow {"n":1}', 'quick']);
    expect(toolMessages(exchange).map((message) => message.tool_call_id)).toEqual(['call_1', 'call_2']);
  });

  it('answers an unknown tool, bad JSON, non-object arguments and a throwing tool with an error and goes on', async () => {
    const { exchange, logs } = await run([
      callsReply(['nope', {}], ['echo', '{not json'], ['echo', '[1]'], ['fail', {}]),
      chatResponse('done'),
    ]);
    const errors = toolMessages(exchange).map((message) => contentOf(message).error as string);
    expect(errors[0]).toContain('no tool named "nope"');
    expect(errors[0]).toContain('echo, fail');
    expect(errors[1]).toContain('not valid JSON');
    expect(errors[2]).toContain('must be a JSON object');
    expect(errors[3]).toBe('It broke');
    expect(exchange.at(-1)).toMatchObject({ role: 'assistant', content: 'done' });
    expect(logs).toHaveLength(4);
    expect(logs[3]).toBe('step 1: fail {} -> error: It broke');
  });

  it('treats blank arguments as an empty object', async () => {
    const { exchange } = await run([callsReply(['echo', '']), chatResponse('done')]);
    expect(contentOf(exchange[1])).toEqual({ echoed: {} });
  });

  it('sends a tool result that is not JSON as null', async () => {
    const nothing: EngineTool = { ...echo, run: async () => undefined };
    const { exchange } = await run([callsReply(['echo', {}]), chatResponse('done')], { tools: [nothing] });
    expect(exchange[1]?.content).toBe('null');
  });

  it('asks for a final answer without tools once the step limit is reached', async () => {
    const { exchange, requests, logs, wires } = await run(
      [callsReply(['echo', { n: 1 }]), callsReply(['echo', { n: 2 }]), chatResponse('final')],
      { maxSteps: 2 },
    );
    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.toolChoice)).toEqual(['auto', 'auto', 'none']);
    // The tools stay declared for the closing call.
    expect(requests[2]?.tools).toHaveLength(2);
    expect(exchange.at(-1)).toMatchObject({ content: 'final' });
    expect(logs).toContain('Step limit (2) reached: asking for a final answer without tool use');
    expect(wires).toBe(3);
  });

  it('drops the calls of a closing answer that ignored tool_choice none', async () => {
    const { exchange, logs } = await run([callsReply(['echo', {}]), callsReply(['echo', {}])], { maxSteps: 1 });
    expect(exchange.at(-1)).toEqual({ role: 'assistant', content: '' });
    expect(logs.at(-1)).toContain('ignored');
  });

  it('applies required to the first call only', async () => {
    const { requests } = await run([callsReply(['echo', {}]), chatResponse('done')], { toolChoice: 'required' });
    expect(requests.map((request) => request.toolChoice)).toEqual(['required', 'auto']);
  });

  it('sends parallel_tool_calls only when set', async () => {
    const unset = await run([chatResponse('a')]);
    expect(unset.requests[0]).not.toHaveProperty('parallelToolCalls');
    const off = await run([chatResponse('a')], { parallelToolCalls: false });
    expect(off.requests[0]).toMatchObject({ parallelToolCalls: false });
  });

  it('stops between calls when the run is stopped', async () => {
    const controller = new AbortController();
    const { ctx } = toolContext();
    const stopping: EngineTool = {
      ...echo,
      run: async () => {
        controller.abort(new Error('stopped'));
        return 'ok';
      },
    };
    await expect(
      runToolLoop({
        request: baseRequest,
        call: async () => callsReply(['echo', {}]),
        tools: [stopping],
        maxSteps: 5,
        toolChoice: 'auto',
        ctx: { ...ctx, signal: controller.signal },
      }),
    ).rejects.toThrow('stopped');
  });
});
