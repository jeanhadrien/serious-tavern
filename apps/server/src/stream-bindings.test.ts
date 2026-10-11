import { describe, expect, it } from 'vitest';
import { prepareWorkflow, registry, type NodeResources } from '@st/engine';
import type { Edge, Preset, Workflow } from '@st/shared';
import { passthroughSources, replyRanks } from './services/stream-bindings.js';

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config: { ...registry.get(type)?.defaultConfig, ...config },
  position: { x: 0, y: 0 },
});
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const workflow = (nodes: Workflow['nodes'], edges: Edge[]): Workflow => ({
  id: 'workflow',
  name: 'Bindings',
  nodes,
  edges,
  createdAt: '',
  updatedAt: '',
});
const preset = (id: string, inputKeys: string[]): Preset => ({
  id,
  name: id,
  createdAt: '',
  updatedAt: '',
  inputs: inputKeys.map((key) => ({ id: `${key}-input`, key, dataType: 'text' as const })),
  entries: [],
});
const plainPresetId = '2b041793-416b-4c94-a541-99ab866230b7';
const chainPresetId = '8f3a2c1e-5d4b-4f6a-9b7c-1e2d3f4a5b6c';
const presets = new Map([
  [plainPresetId, preset(plainPresetId, [])],
  [chainPresetId, preset(chainPresetId, ['draft'])],
]);
const resources: NodeResources = { presets: { get: async (id) => presets.get(id) } };
// Plain LLMs take no inputs; chained LLMs take their text from a `draft` preset input.
const llm = (id: string) => node(id, 'llm', { presetId: plainPresetId });
const chainedLlm = (id: string) => node(id, 'llm', { presetId: chainPresetId });

// Every workflow needs exactly one chat-input node; it is added here so each case only lists what it tests.
async function preparedFor(nodes: Workflow['nodes'], edges: Edge[]) {
  const result = await prepareWorkflow(workflow([node('input', 'chat-input'), ...nodes], edges), resources);
  if (!result.prepared) throw new Error(result.errors.map((issue) => issue.message).join('; '));
  return result.prepared;
}

describe('passthroughSources', () => {
  it('binds an output whose reply is exactly one LLM text, with no template', async () => {
    const prepared = await preparedFor(
      [llm('llm'), node('output', 'chat-output')],
      [edge('llm', 'text', 'output', 'value')],
    );
    expect(passthroughSources(prepared)).toEqual(new Map([['output', 'llm']]));
  });

  it('leaves outputs with a template on the buffered path', async () => {
    const prepared = await preparedFor(
      [llm('llm'), node('output', 'chat-output', { template: '[{{input.value}}]' })],
      [edge('llm', 'text', 'output', 'value')],
    );
    expect(passthroughSources(prepared).size).toBe(0);
  });

  it('leaves outputs fed by a merge of several sources on the buffered path', async () => {
    const prepared = await preparedFor(
      [llm('first'), llm('second'), node('merge', 'merge', { mode: 'first-non-empty' }), node('output', 'chat-output')],
      [
        edge('first', 'text', 'merge', 'a'),
        edge('second', 'text', 'merge', 'b'),
        edge('merge', 'value', 'output', 'value'),
      ],
    );
    expect(passthroughSources(prepared).size).toBe(0);
  });

  it('binds each LLM-fed output in a reply chain, but not an output fed by another output’s reply', async () => {
    const prepared = await preparedFor(
      [llm('first'), node('early', 'chat-output'), chainedLlm('second'), node('late', 'chat-output')],
      [
        edge('first', 'text', 'early', 'value'),
        edge('early', 'reply', 'second', 'draft'),
        edge('second', 'text', 'late', 'value'),
      ],
    );
    expect(passthroughSources(prepared)).toEqual(
      new Map([
        ['early', 'first'],
        ['late', 'second'],
      ]),
    );
  });

  it('does not bind an output fed directly by another output’s reply', async () => {
    const prepared = await preparedFor(
      [llm('llm'), node('early', 'chat-output'), node('late', 'chat-output')],
      [edge('llm', 'text', 'early', 'value'), edge('early', 'reply', 'late', 'value')],
    );
    expect(passthroughSources(prepared)).toEqual(new Map([['early', 'llm']]));
  });

  it('keeps an output bound statically even when its branch is skipped at run time', async () => {
    const prepared = await preparedFor(
      [
        node('gate', 'condition', { left: '{{input.value}}', right: 'hi', operator: 'equals' }),
        chainedLlm('llm'),
        node('output', 'chat-output'),
      ],
      [
        edge('input', 'message', 'gate', 'value'),
        edge('gate', 'true', 'llm', 'draft'),
        edge('llm', 'text', 'output', 'value'),
      ],
    );
    expect(passthroughSources(prepared)).toEqual(new Map([['output', 'llm']]));
  });
});

describe('replyRanks', () => {
  it('ranks outputs by the order config, then node id', async () => {
    const prepared = await preparedFor(
      [
        llm('llm'),
        node('b', 'chat-output', { order: 0 }),
        node('a', 'chat-output', { order: 1 }),
        node('c', 'chat-output', { order: 1 }),
      ],
      [edge('llm', 'text', 'a', 'value'), edge('llm', 'text', 'b', 'value'), edge('llm', 'text', 'c', 'value')],
    );
    expect([...replyRanks(prepared)]).toEqual([
      ['b', 0],
      ['a', 1],
      ['c', 2],
    ]);
  });

  it('ranks an output before the outputs it feeds, whatever their order config', async () => {
    const prepared = await preparedFor(
      [
        llm('first'),
        node('early', 'chat-output', { order: 5 }),
        chainedLlm('second'),
        node('late', 'chat-output', { order: -5 }),
      ],
      [
        edge('first', 'text', 'early', 'value'),
        edge('early', 'reply', 'second', 'draft'),
        edge('second', 'text', 'late', 'value'),
      ],
    );
    expect([...replyRanks(prepared)]).toEqual([
      ['early', 0],
      ['late', 1],
    ]);
  });

  it('ranks outputs fed by a shared upstream after the outputs with a smaller upstream', async () => {
    const prepared = await preparedFor(
      [
        llm('first'),
        node('out1', 'chat-output', { order: 10 }),
        chainedLlm('second'),
        node('out2', 'chat-output', { order: -10 }),
      ],
      [
        edge('first', 'text', 'out1', 'value'),
        edge('first', 'text', 'second', 'draft'),
        edge('second', 'text', 'out2', 'value'),
      ],
    );
    expect([...replyRanks(prepared)]).toEqual([
      ['out1', 0],
      ['out2', 1],
    ]);
  });
});
