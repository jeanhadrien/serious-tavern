import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ChatMessage, Edge, Workflow } from '@st/shared';
import { executeWorkflow, validateWorkflow } from './executor.js';
import { pruneInvalidEdges } from './prune.js';
import { random } from './nodes/random/index.js';
import { createRandom } from './seeded-random.js';
import type { ExecutionContext } from './types.js';

// Runs the node directly on a parsed config, with scripted draws.
const run = (config: Record<string, unknown>, inputs: Record<string, unknown> = {}, ...draws: number[]) => {
  const queue = [...draws];
  const ctx: ExecutionContext = {
    nodeId: 'random',
    inputs,
    config: random.configSchema.parse(config),
    trigger: { message: '', sessionId: 's' },
    settings: {},
    history: [],
    secrets: { get: async () => undefined },
    resources: { presets: { get: async () => undefined } },
    signal: new AbortController().signal,
    log: () => {},
    random: () => {
      if (!queue.length) throw new Error('drew more than scripted');
      return queue.shift()!;
    },
    recordWire: () => {},
    emit: () => {},
  };
  return random.execute(ctx);
};
const portsOf = async (config: Record<string, unknown>) => {
  const ports = await random.resolvePorts!(config, { presets: { get: async () => undefined } });
  return {
    inputs: ports.inputs.map((port) => `${port.name}:${port.dataType}`),
    outputs: ports.outputs.map((port) => `${port.name}:${port.dataType}${port.optional ? '?' : ''}`),
  };
};

describe('Random node config', () => {
  it('defaults to number mode and offers the modes as a dropdown', () => {
    expect(random.configSchema.parse({})).toEqual(random.defaultConfig);
    const schema = z.toJSONSchema(random.configSchema) as {
      properties: Record<string, { type?: string; enum?: string[]; default?: unknown }>;
      required?: string[];
    };
    expect(schema.properties.mode).toMatchObject({ enum: ['number', 'integer', 'pick', 'chance'], default: 'number' });
    // Plain optional numbers, so the generic form shows them blank and a blank one falls back per mode.
    for (const bound of ['min', 'max']) {
      expect(schema.properties[bound]).toMatchObject({ type: 'number' });
      expect(schema.properties[bound]).not.toHaveProperty('default');
      expect(schema.required ?? []).not.toContain(bound);
    }
  });

  const wrap = (config: Record<string, unknown>): Workflow => ({
    id: 'w',
    name: 'W',
    createdAt: '',
    updatedAt: '',
    nodes: [
      { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
      { id: 'random', type: 'random', config, position: { x: 0, y: 0 } },
      { id: 'output', type: 'chat-output', config: {}, position: { x: 0, y: 0 } },
    ],
    edges: [{ id: 'e', source: 'input', sourceHandle: 'message', target: 'output', targetHandle: 'value' }],
  });
  it.each([
    [{ mode: 'integer', min: 6, max: 1 }, 'max: Max must be at least min'],
    [{ mode: 'integer', min: 1.5 }, 'min: Integer mode needs whole numbers for min and max'],
    [{ mode: 'integer', max: 2.5 }, 'max: Integer mode needs whole numbers for min and max'],
    [{ mode: 'number', max: -1 }, 'max: Max must be at least min'],
    [{ mode: 'integer', min: 7 }, 'max: Max must be at least min'],
    [{ mode: 'chance', probability: 2 }, 'probability: Probability must be between 0 and 1'],
    [{ mode: 'chance', probability: -0.1 }, 'probability: Probability must be between 0 and 1'],
  ])('rejects %j before the run', async (config, message) => {
    const issues = await validateWorkflow(wrap(config));
    expect(issues.map((issue) => issue.message)).toEqual([`"Random #1 (random)" has an invalid config: ${message}`]);
  });
  it.each([
    { mode: 'pick', min: 9, max: 1 },
    { mode: 'chance', min: 9, max: 1 },
    { mode: 'integer', min: 3, max: 3 },
    { mode: 'number', min: 0.5, max: 0.5 },
    { mode: 'number', min: -0.5 },
  ])('accepts %j (bounds are only checked where they are used)', async (config) => {
    const issues = await validateWorkflow(wrap(config));
    expect(issues.filter((issue) => issue.message.includes('invalid config'))).toEqual([]);
  });
});

describe('Random node ports', () => {
  it.each([
    [{}, [], ['value:number', 'roll:number']],
    [{ mode: 'number' }, [], ['value:number', 'roll:number']],
    [{ mode: 'integer' }, [], ['value:number', 'roll:number']],
    [{ mode: 'pick' }, ['items:array'], ['value:any?', 'roll:number']],
    [
      { mode: 'chance' },
      ['probability:number', 'value:any'],
      ['value:boolean', 'true:any?', 'false:any?', 'roll:number'],
    ],
  ])('resolves %j', async (config, inputs, outputs) => {
    expect(await portsOf(config)).toEqual({ inputs, outputs });
  });
  it('requires the pick list', async () => {
    const ports = await random.resolvePorts!({ mode: 'pick' }, { presets: { get: async () => undefined } });
    expect(ports.inputs[0]?.required).toBe(true);
  });
  it('rejects an unknown mode, keeping its edges', async () => {
    await expect(portsOf({ mode: 'nope' })).rejects.toThrow('Unknown mode "nope"');
  });
  it('keeps the value edge and drops the chance-only edges when the mode changes', async () => {
    const at = { x: 0, y: 0 };
    const workflow: Workflow = {
      id: 'w',
      name: 'W',
      createdAt: '',
      updatedAt: '',
      nodes: [
        { id: 'input', type: 'chat-input', config: {}, position: at },
        { id: 'random', type: 'random', config: { mode: 'number' }, position: at },
        { id: 'output', type: 'chat-output', config: {}, position: at },
      ],
      edges: [
        { id: 'p', source: 'input', sourceHandle: 'message', target: 'random', targetHandle: 'probability' },
        { id: 'v', source: 'input', sourceHandle: 'message', target: 'random', targetHandle: 'value' },
        { id: 't', source: 'random', sourceHandle: 'true', target: 'output', targetHandle: 'value' },
        { id: 'r', source: 'random', sourceHandle: 'value', target: 'output', targetHandle: 'character' },
      ],
    };
    const pruned = await pruneInvalidEdges(workflow, { presets: { get: async () => undefined } });
    expect(pruned.edges.map((edge) => edge.id)).toEqual(['r']);
  });
  it('shows number ports before the first resolve', () => {
    expect(random.inputs).toEqual([]);
    expect(random.outputs.map((port) => port.name)).toEqual(['value', 'roll']);
  });
});

describe('Random node modes', () => {
  it.each([
    [{}, 0.25, 0.25],
    [{}, 0, 0],
    [{ min: 10, max: 20 }, 0.5, 15],
    [{ min: -1, max: 1 }, 0.75, 0.5],
    [{ min: 3, max: 3 }, 0.9, 3],
  ])('number %j with roll %d gives %d', async (config, draw, value) => {
    expect(await run({ mode: 'number', ...config }, {}, draw)).toEqual({ value, roll: draw });
  });

  it.each([
    [{}, 0, 1],
    [{}, 0.999999, 6],
    [{}, 0.5, 4],
    [{ min: -2, max: 2 }, 0, -2],
    [{ min: -2, max: 2 }, 0.99, 2],
    [{ min: 5, max: 5 }, 0.7, 5],
  ])('integer %j with roll %d gives %d', async (config, draw, value) => {
    expect(await run({ mode: 'integer', ...config }, {}, draw)).toEqual({ value, roll: draw });
  });

  it('rolls every face of a die and nothing else', async () => {
    const next = createRandom('dice');
    const faces = new Map<number, number>();
    for (let i = 0; i < 1000; i++) {
      const { value } = (await run({ mode: 'integer' }, {}, next())) as { value: number };
      faces.set(value, (faces.get(value) ?? 0) + 1);
    }
    expect([...faces.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const count of faces.values()) expect(count).toBeGreaterThan(100);
  });

  it.each([
    [0, 'a'],
    [0.33, 'a'],
    [0.5, 'b'],
    [0.99, 'c'],
  ])('picks uniformly from plain items (roll %d → %s)', async (draw, value) => {
    expect(await run({ mode: 'pick' }, { items: ['a', 'b', 'c'] }, draw)).toEqual({ value, roll: draw });
  });

  const heavy = { t: 'b', weight: 3 };
  it.each([
    ['weights', {}, [{ t: 'a', weight: 1 }, heavy], 0.2, { t: 'a', weight: 1 }],
    ['weights', {}, [{ t: 'a', weight: 1 }, heavy], 0.3, heavy],
    ['an item without weight as 1', {}, [{ t: 'a' }, heavy], 0.2, { t: 'a' }],
    ['a plain item next to weighted ones as 1', {}, ['a', heavy], 0.24, 'a'],
    ['a text weight as no weight', {}, [{ t: 'a', weight: '5' }, heavy], 0.2, { t: 'a', weight: '5' }],
    [
      'a custom weight field',
      { weightField: 'w' },
      [
        { t: 'a', w: 3 },
        { t: 'b', weight: 100 },
      ],
      0.7,
      { t: 'a', w: 3 },
    ],
    ['a blank weight field as unweighted', { weightField: '' }, [{ t: 'a', weight: 100 }, heavy], 0.6, heavy],
  ])('counts %s', async (_, config, items, draw, value) => {
    expect(await run({ mode: 'pick', ...config }, { items }, draw)).toEqual({ value, roll: draw });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'never picks an item weighing %d, even at roll 0',
    async (weight) => {
      const items = [{ t: 'never', weight }, { t: 'ok' }];
      expect(await run({ mode: 'pick' }, { items }, 0)).toEqual({ value: { t: 'ok' }, roll: 0 });
    },
  );

  it('picks the last eligible item at the top of the range', async () => {
    expect(await run({ mode: 'pick' }, { items: ['a', 'b', { weight: 0 }] }, 0.9999999999999999)).toMatchObject({
      value: 'b',
    });
  });

  it.each([[[]], [[{ weight: 0 }, { weight: -2 }]]])(
    'outputs only the roll when nothing can be picked from %j',
    async (items) => {
      expect(await run({ mode: 'pick' }, { items }, 0.4)).toEqual({ roll: 0.4 });
    },
  );

  it.each([
    ['text', 'a,b'],
    ['an object', { a: 1 }],
    ['nothing', undefined],
  ])('fails on items that are %s', async (kind, items) => {
    await expect(run({ mode: 'pick' }, { items }, 0.4)).rejects.toThrow(`Items must be a list, got ${kind}`);
  });

  it.each([
    ['the config', { probability: 0.5 }, {}, 0.4, true],
    ['the config', { probability: 0.5 }, {}, 0.6, false],
    ['the config', { probability: 0.5 }, {}, 0.5, false],
    ['the default config', {}, {}, 0.49, true],
    ['the input over the config', { probability: 0 }, { probability: 1 }, 0.999, true],
    ['the input over the config', { probability: 1 }, { probability: 0 }, 0, false],
    ['an input above 1 as 1', {}, { probability: 1.7 }, 0.999, true],
    ['an input below 0 as 0', {}, { probability: -3 }, 0, false],
    ['probability 0 as never', { probability: 0 }, {}, 0, false],
    ['probability 1 as always', { probability: 1 }, {}, 0.999999, true],
  ])('chance uses %s', async (_, config, inputs, draw, result) => {
    expect(await run({ mode: 'chance', ...config }, inputs, draw)).toEqual({
      value: result,
      [String(result)]: result,
      roll: draw,
    });
  });

  it('passes the value input to the branch that is taken', async () => {
    expect(await run({ mode: 'chance' }, { value: 'x' }, 0.1)).toEqual({ value: true, true: 'x', roll: 0.1 });
    expect(await run({ mode: 'chance' }, { value: { a: 1 } }, 0.9)).toEqual({
      value: false,
      false: { a: 1 },
      roll: 0.9,
    });
  });

  it.each([
    ['text', '0.3'],
    ['null', null],
    ['NaN (not a number)', Number.NaN],
    ['an infinite number', Number.POSITIVE_INFINITY],
  ])('fails on a probability input that is %s', async (kind, probability) => {
    await expect(run({ mode: 'chance' }, { probability }, 0.1)).rejects.toThrow(
      `Probability must be a number, got ${kind}`,
    );
  });
});

describe('Random node in a workflow', () => {
  const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
    id,
    type,
    config,
    position: { x: 0, y: 0 },
  });
  const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
    id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  });
  const graph = (nodes: Workflow['nodes'], edges: Edge[]): Workflow => ({
    id: 'w',
    name: 'W',
    nodes,
    edges,
    createdAt: '',
    updatedAt: '',
  });
  const options = {
    message: 'hello',
    sessionId: 'session',
    history: [] as ChatMessage[],
    secrets: { get: async () => undefined },
  };

  it('rolls the same with the same seed, from the "<seed>:<node id>" stream, and logs the roll', async () => {
    const dice = graph(
      [node('input', 'chat-input'), node('random', 'random', { mode: 'integer' }), node('output', 'chat-output')],
      [edge('random', 'value', 'output', 'value')],
    );
    const first = await executeWorkflow(dice, { ...options, seed: 'turn-7' });
    const second = await executeWorkflow(dice, { ...options, seed: 'turn-7' });
    const draw = createRandom('turn-7:random')();
    const expected = { value: 1 + Math.floor(draw * 6), roll: draw };
    expect(first.execution.nodes.random?.output).toEqual(expected);
    expect(second.execution.nodes.random?.output).toEqual(expected);
    expect(first.replies.map((reply) => reply.content)).toEqual([String(expected.value)]);
  });

  const branches = (probability: number) =>
    graph(
      [
        node('input', 'chat-input'),
        node('random', 'random', { mode: 'chance', probability }),
        node('yes', 'chat-output'),
        node('no', 'chat-output'),
      ],
      [
        edge('input', 'message', 'random', 'value'),
        edge('random', 'true', 'yes', 'value'),
        edge('random', 'false', 'no', 'value'),
      ],
    );
  it.each([
    [1, 'yes', 'no'],
    [0, 'no', 'yes'],
  ])('routes the value with probability %d to %s and skips %s', async (probability, taken, skipped) => {
    const result = await executeWorkflow(branches(probability), options);
    expect(result.replies).toEqual([{ nodeId: taken, content: 'hello' }]);
    expect(result.execution.nodes[skipped]?.status).toBe('skipped');
  });

  it('takes its probability from another node', async () => {
    const chained = graph(
      [
        node('input', 'chat-input'),
        node('one', 'random', { mode: 'number', min: 1, max: 1 }),
        node('random', 'random', { mode: 'chance', probability: 0 }),
        node('yes', 'chat-output'),
        node('no', 'chat-output'),
      ],
      [
        edge('one', 'value', 'random', 'probability'),
        edge('input', 'message', 'random', 'value'),
        edge('random', 'true', 'yes', 'value'),
        edge('random', 'false', 'no', 'value'),
      ],
    );
    const result = await executeWorkflow(chained, options);
    expect(result.replies.map((reply) => reply.nodeId)).toEqual(['yes']);
  });

  it('skips what follows when nothing can be picked', async () => {
    const picker = graph(
      [node('input', 'chat-input'), node('random', 'random', { mode: 'pick' }), node('output', 'chat-output')],
      [edge('input', 'history', 'random', 'items'), edge('random', 'value', 'output', 'value')],
    );
    const result = await executeWorkflow(picker, options);
    expect(result.replies).toEqual([]);
    expect(result.execution.nodes.random?.status).toBe('completed');
    expect(result.execution.nodes.output?.status).toBe('skipped');
    expect(result.execution.warnings).toContain('No Chat Output nodes ran; this turn produced no assistant messages.');
  });

  it('picks a message from the history', async () => {
    const history: ChatMessage[] = [
      { id: '1', role: 'user', content: 'first', createdAt: '' },
      { id: '2', role: 'assistant', content: 'second', createdAt: '' },
    ];
    const picker = graph(
      [
        node('input', 'chat-input'),
        node('random', 'random', { mode: 'pick' }),
        node('output', 'chat-output', { template: '{{input.value.content}}' }),
      ],
      [edge('input', 'history', 'random', 'items'), edge('random', 'value', 'output', 'value')],
    );
    const result = await executeWorkflow(picker, { ...options, history, seed: 's' });
    const expected = createRandom('s:random')() < 0.5 ? 'first' : 'second';
    expect(result.replies.map((reply) => reply.content)).toEqual([expected]);
  });
});
