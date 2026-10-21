import { afterEach, describe, expect, it } from 'vitest';
import type { Workflow } from '@st/shared';
import { executeWorkflow, validateWorkflow } from './executor.js';
import { descriptors } from './registry.js';
import { chatResponse, restoreAdapter, useAdapter } from './test-providers.js';
import { callsReply, llmWorkflow, resources, runOptions, scriptedModel, target } from './tools/test-tools.js';
import type { EngineEvent } from './types.js';

// An LLM node is a sink exactly when its tools can write state: it then runs with no Chat Output downstream.

afterEach(restoreAdapter);

/** The LLM workflow without its Chat Output: the model's only possible effect is what its tools write. */
const withoutOutput = (config: Record<string, unknown>): Workflow => {
  const workflow = llmWorkflow(config);
  return {
    ...workflow,
    nodes: workflow.nodes.filter((node) => node.id !== 'output'),
    edges: [],
  };
};

const writeTools = { read: [], write: [target('tension')] };

describe('an LLM node as a sink', () => {
  it('validates a workflow whose only sink is an LLM node with write tools', async () => {
    expect(await validateWorkflow(withoutOutput({ tools: writeTools }), resources)).toEqual([]);
  });

  it('still needs a sink when the LLM node only reads or has no tools', async () => {
    for (const tools of [undefined, { read: [target('tension')], write: [] }]) {
      const issues = await validateWorkflow(withoutOutput(tools ? { tools } : {}), resources);
      expect(issues.map((issue) => issue.message)).toEqual([
        'A workflow must contain at least one node that writes something, such as a Chat Output, a State Write or an LLM with write tools.',
      ]);
    }
  });

  it('runs with no Chat Output and stores its writes', async () => {
    const model = scriptedModel(callsReply(['write_scene_tension', { op: 'set', value: 7 }]), chatResponse('Done.'));
    useAdapter(model.adapter);
    const result = await executeWorkflow(withoutOutput({ tools: writeTools }), runOptions);
    expect(result.execution.nodes.llm?.status).toBe('completed');
    expect(result.replies).toEqual([]);
    expect(result.writes).toMatchObject([{ op: 'set', value: 7, nodeId: 'llm' }]);
  });

  it('skips an LLM node without write tools that no output needs, as before', async () => {
    const model = scriptedModel(chatResponse('Unused'));
    useAdapter(model.adapter);
    // The workflow needs another sink to be valid: the Chat Output replies with the message, and the LLM node dangles.
    const workflow = llmWorkflow({ tools: { read: [target('tension')], write: [] } });
    workflow.edges = [{ id: 'e', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'value' }];
    const result = await executeWorkflow(workflow, runOptions);
    expect(result.execution.nodes.llm?.status).toBe('skipped');
    expect(model.requests).toHaveLength(0);
  });

  it('is described as a sink by its default config only', () => {
    expect(descriptors().find((descriptor) => descriptor.type === 'llm')?.sink).toBe(false);
  });
});

describe('the steps of a tool loop in the event stream', () => {
  it('marks the start of every step after the first, between the text deltas', async () => {
    const model = scriptedModel(callsReply(['write_scene_tension', { op: 'set', value: 1 }]), chatResponse('Done.'));
    useAdapter({
      chat: model.adapter.chat,
      stream: async (request, options) => {
        const response = await model.adapter.chat(request, options);
        if (response.text) options.onToken(response.text);
        return response;
      },
    });
    const events: EngineEvent[] = [];
    await executeWorkflow(llmWorkflow({ tools: writeTools }), {
      ...runOptions,
      onEvent: (event) => events.push(event),
    });
    const deltas = events.filter((event) => event.type === 'node:delta').map((event) => event.detail);
    expect(deltas).toEqual([{ stepStart: true }, { textDelta: 'Done.' }]);
  });
});
