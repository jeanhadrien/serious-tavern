import { describe, expect, it } from 'vitest';
import { canConnect } from '@st/shared';
import { registry } from './registry.js';
import { executeWorkflow } from './executor.js';
import { trigger } from './nodes/trigger/index.js';
import { signalNameProblem } from './nodes/trigger/config.js';
import { edge, graph, node, resourcesWith, runNode } from './test-collections.js';
import { snapshotOf } from './test-state.js';

const resources = resourcesWith();
const base = { baseChance: 1, growthPerTurn: 0, volatility: 0.5, maxLevel: 5 };
const run = (
  config: Record<string, unknown>,
  extra: Parameters<typeof runNode>[2] extends infer O ? Partial<O> : never,
) => runNode(trigger, { ...base, ...config }, { resources, ...extra });

describe('Trigger config', () => {
  it('has the documented defaults and is registered under Creativity', () => {
    expect(registry.get('trigger')).toBe(trigger);
    expect(trigger.category).toBe('Creativity');
    expect(trigger.configSchema.parse({})).toEqual({
      baseChance: 0.1,
      growthPerTurn: 0.05,
      volatility: 0.3,
      maxLevel: 2,
      cooldowns: { '1': 0, '2': 2, '3': 4, '4': 8, '5': 15 },
      levelWeights: { '1': 5, '2': 3, '3': 2, '4': 1, '5': 0.5 },
      signals: [],
    });
    expect(trigger.configSchema.parse(trigger.defaultConfig)).toEqual(trigger.configSchema.parse({}));
  });

  it('fills the levels a partly filled object leaves out', () => {
    const parsed = trigger.configSchema.parse({ cooldowns: { '3': 9 }, levelWeights: { '1': 0 } }) as {
      cooldowns: Record<string, number>;
      levelWeights: Record<string, number>;
    };
    expect(parsed.cooldowns).toEqual({ '1': 0, '2': 2, '3': 9, '4': 8, '5': 15 });
    expect(parsed.levelWeights).toEqual({ '1': 0, '2': 3, '3': 2, '4': 1, '5': 0.5 });
  });

  it.each([
    [{ baseChance: 1.1 }, 'Base chance must be between 0 and 1'],
    [{ baseChance: -0.1 }, 'Base chance must be between 0 and 1'],
    [{ volatility: 2 }, 'Volatility must be between 0 and 1'],
    [{ growthPerTurn: -1 }, 'Growth per turn can not be negative'],
    [{ maxLevel: 0 }, 'Max level goes from 1 to 5'],
    [{ maxLevel: 6 }, 'Max level goes from 1 to 5'],
    [{ maxLevel: 2.5 }, undefined],
    [{ cooldowns: { '2': -1 } }, 'A cooldown can not be negative'],
    [{ cooldowns: { '2': 1.5 } }, undefined],
    [{ levelWeights: { '2': -1 } }, 'A level weight can not be negative'],
    [{ signals: [{ name: '', weight: 1 }] }, 'Name every signal or remove its row'],
    [{ signals: [{ name: 'bad name', weight: 1 }] }, 'Signal name "bad name" must start with a letter'],
    [{ signals: [{ name: 'value', weight: 1 }] }, 'Signal name "value" is already an input of the node'],
    [
      {
        signals: [
          { name: 'a', weight: 1 },
          { name: 'a', weight: 2 },
        ],
      },
      'Signal "a" is listed twice',
    ],
  ])('rejects %j', (config, message) => {
    const result = trigger.configSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (message) expect(result.error!.issues.map((issue) => issue.message).join('\n')).toContain(message);
  });

  it('names what is wrong with a signal name', () => {
    expect(signalNameProblem('stagnation')).toBeUndefined();
    expect(signalNameProblem('a_1')).toBeUndefined();
    for (const name of ['1a', 'a b', 'a-b', '_a', 'volatility', 'maxLevel', 'value'])
      expect(signalNameProblem(name)).toBeDefined();
  });
});

describe('Trigger ports', () => {
  it('has the fixed inputs and outputs, and numbers connect to its number inputs', () => {
    expect(trigger.inputs.map((port) => [port.name, port.dataType, !!port.requiredIfConnected])).toEqual([
      ['volatility', 'number', true],
      ['maxLevel', 'number', true],
      ['value', 'any', true],
    ]);
    expect(trigger.outputs.map((port) => [port.name, port.dataType, !!port.optional])).toEqual([
      ['fire', 'boolean', false],
      ['level', 'number', true],
      ['true', 'any', true],
      ['false', 'any', true],
      ['score', 'number', false],
      ['roll', 'number', false],
      ['reason', 'text', false],
    ]);
    expect(canConnect('any', 'number').ok).toBe(true);
    expect(canConnect('number', 'number').ok).toBe(true);
  });

  it('adds one optional number input per signal, in order', async () => {
    const ports = await trigger.resolvePorts!(
      {
        signals: [
          { name: 'stagnation', weight: 0.5 },
          { name: 'gap', weight: 1 },
        ],
      },
      resources,
    );
    expect(ports.inputs.map((port) => port.name)).toEqual(['volatility', 'maxLevel', 'value', 'stagnation', 'gap']);
    const signal = ports.inputs[3]!;
    expect(signal).toMatchObject({ dataType: 'number', label: 'stagnation' });
    expect(signal.required).toBeFalsy();
    expect(signal.requiredIfConnected).toBeFalsy();
    expect(ports.outputs).toBe(trigger.outputs);
  });

  it('reads an unparsed config: no signals, rows without a name, and padded names', async () => {
    expect((await trigger.resolvePorts!({}, resources)).inputs).toHaveLength(3);
    expect((await trigger.resolvePorts!({ signals: 'nope' }, resources)).inputs).toHaveLength(3);
    const ports = await trigger.resolvePorts!({ signals: [{ name: '' }, { name: '  a  ' }, null] }, resources);
    expect(ports.inputs.map((port) => port.name)).toEqual(['volatility', 'maxLevel', 'value', 'a']);
  });

  it.each([
    [[{ name: 'bad name', weight: 1 }], 'Signal name "bad name" must start with a letter'],
    [[{ name: 'maxLevel', weight: 1 }], 'Signal name "maxLevel" is already an input of the node'],
    [
      [
        { name: 'a', weight: 1 },
        { name: 'a', weight: 1 },
      ],
      'Signal "a" is listed twice',
    ],
  ])('refuses %j', async (signals, message) => {
    await expect(trigger.resolvePorts!({ signals }, resources)).rejects.toThrow(message);
  });
});

describe('Trigger run', () => {
  it('fires: outputs, branch, and one write of its own node key', async () => {
    const result = await run({}, { draws: [0, 0] });
    expect(result.output).toMatchObject({ fire: true, level: 1, true: true, score: 1, roll: 0 });
    expect(result.output).not.toHaveProperty('false');
    expect(result.output.reason).toContain('level 1 chosen');
    expect(result.writes).toEqual([
      {
        op: 'add',
        target: { kind: 'node', nodeId: 'trigger', key: 'fires' },
        nodeId: 'trigger',
        item: { id: 'run:trigger:1', text: 'fired at level 1', level: 1 },
      },
    ]);
    expect(result.drawn).toBe(2);
  });

  it('does not fire: no level, the false branch, nothing written, one draw', async () => {
    const result = await run({ baseChance: 0.1 }, { draws: [0.99] });
    expect(result.output).toMatchObject({ fire: false, false: false, roll: 0.99 });
    expect(result.output).not.toHaveProperty('level');
    expect(result.output).not.toHaveProperty('true');
    expect(result.writes).toEqual([]);
    expect(result.drawn).toBe(1);
  });

  it('passes the value input to the branch that is taken', async () => {
    const fired = await run({}, { draws: [0, 0], inputs: { value: { note: 'x' } } });
    expect(fired.output).toMatchObject({ true: { note: 'x' } });
    expect(fired.output).not.toHaveProperty('false');
    const missed = await run({ baseChance: 0 }, { draws: [0.5], inputs: { value: 'hello' } });
    expect(missed.output).toMatchObject({ false: 'hello' });
    expect(missed.output).not.toHaveProperty('true');
  });

  it('weighs the signals that are connected and counts the others as 0', async () => {
    const config = {
      baseChance: 0,
      volatility: 0.5,
      signals: [
        { name: 'a', weight: 0.5 },
        { name: 'b', weight: 0.25 },
      ],
    };
    const both = await run(config, { draws: [0.99], inputs: { a: 1, b: 1 } });
    expect(both.output.score).toBeCloseTo(0.75);
    expect(both.output.reason).toContain('(0 + 0×1 + 0.5×1 a + 0.25×1 b) × 1');
    const one = await run(config, { draws: [0.99], inputs: { a: 0.5 } });
    expect(one.output.score).toBeCloseTo(0.25);
    expect(one.output.reason).toContain('0.5×0.5 a + 0.25×0 b');
  });

  it('clamps a signal to 0..1 and accepts numeric text', async () => {
    const config = { baseChance: 0, signals: [{ name: 'a', weight: 0.5 }] };
    expect((await run(config, { draws: [0.99], inputs: { a: 7 } })).output.score).toBeCloseTo(0.5);
    expect((await run(config, { draws: [0.99], inputs: { a: -3 } })).output.score).toBe(0);
    expect((await run(config, { draws: [0.99], inputs: { a: '0.4' } })).output.score).toBeCloseTo(0.2);
  });

  it.each([
    ['volatility', 'abc', 'Volatility must be a number, got "abc"'],
    ['maxLevel', {}, 'Max level must be a number, got an object'],
    ['a', null, 'Signal "a" must be a number, got null'],
  ])('fails on a %s input that is not a number', async (name, value, message) => {
    await expect(
      run({ signals: [{ name: 'a', weight: 1 }] }, { draws: [0, 0], inputs: { [name]: value } }),
    ).rejects.toThrow(message);
  });

  it('takes volatility and max level from the inputs, which win over the config', async () => {
    const config = { baseChance: 0.5, growthPerTurn: 0, volatility: 0 };
    expect((await run(config, { draws: [0.99] })).output.score).toBeCloseTo(0.25);
    expect((await run(config, { draws: [0.99], inputs: { volatility: 0.5 } })).output.score).toBeCloseTo(0.5);
    // Numeric text (an enum chat setting) and an overshoot are fine; the factor is capped at 1.5.
    expect((await run(config, { draws: [0.99], inputs: { volatility: '9' } })).output.score).toBeCloseTo(0.75);
    const capped = await run({ maxLevel: 5 }, { draws: [0, 0.99], inputs: { maxLevel: 2 } });
    expect(capped.output.level).toBe(2);
    const text = await run({ maxLevel: 5 }, { draws: [0, 0.99], inputs: { maxLevel: '1' } });
    expect(text.output.level).toBe(1);
  });

  it('reads its firings from its own node key, with the turn that wrote each', async () => {
    const state = snapshotOf([], {
      turn: 6,
      nodes: {
        trigger: {
          fires: {
            value: [
              { id: 'b', text: 'fired at level 2', level: 2 },
              { id: 'a', text: 'fired at level 1', level: 1 },
            ],
            itemTurns: [5, 1],
          },
        },
      },
    });
    // Level 2 fired last turn (cooldown 2): only level 1 (no cooldown) is left at max level 2.
    const result = await run({ maxLevel: 2 }, { draws: [0, 0.99], state });
    expect(result.output).toMatchObject({ fire: true, level: 1 });
    expect(result.output.reason).toContain('level 1 chosen (level 2 on cooldown for 1 more turn;');
    // Turns since the last firing of any level: 6 - 5.
    expect(result.output.reason).toContain('(1 + 0×1)');
  });

  it('ignores a node key it does not understand', async () => {
    const state = snapshotOf([], {
      turn: 3,
      nodes: { trigger: { fires: { value: 'nonsense', itemTurns: [1] } } },
    });
    const result = await run({ growthPerTurn: 0.1, baseChance: 0 }, { draws: [0.99], state });
    expect(result.output.reason).toContain('0.1×3');
  });

  it('fires nothing and says why when every level is on cooldown', async () => {
    const state = snapshotOf([], {
      turn: 2,
      nodes: { trigger: { fires: { value: [{ id: 'a', text: 't', level: 1 }], itemTurns: [1] } } },
    });
    const result = await run({ maxLevel: 1, cooldowns: { '1': 3 } }, { draws: [0], state });
    expect(result.output).toMatchObject({ fire: false });
    expect(result.output.reason).toContain('but no level can fire (level 1 on cooldown for 2 more turns');
    expect(result.writes).toEqual([]);
  });
});

describe('Trigger in a workflow', () => {
  const wf = () =>
    graph(
      [
        node('input', 'chat-input'),
        node('trigger', 'trigger', { ...base, baseChance: 0.5, volatility: 0 }),
        node('output', 'chat-output'),
        node('gate', 'chat-output', { order: 1 }),
      ],
      [edge('trigger', 'reason', 'output', 'value'), edge('trigger', 'true', 'gate', 'value')],
    );
  const play = (workflow = wf(), seed = 'fixed') =>
    executeWorkflow(workflow, {
      message: 'hi',
      sessionId: 's',
      history: [],
      secrets: { get: async () => undefined },
      resources,
      seed,
      executionId: 'run',
      state: snapshotOf([]),
    });

  it('gives the same outcome for the same seed and a branch only on the side taken', async () => {
    const seen = new Set<boolean>();
    for (let n = 0; n < 30; n++) {
      const first = await play(wf(), `seed-${n}`);
      const second = await play(wf(), `seed-${n}`);
      expect(second.replies).toEqual(first.replies);
      expect(second.writes).toEqual(first.writes);
      const fired = first.writes.length === 1;
      seen.add(fired);
      // `true` feeds the second output, so it only replies when the Trigger fired.
      expect(first.replies.map((reply) => reply.nodeId)).toEqual(fired ? ['output', 'gate'] : ['output']);
    }
    // A score of 0.25 fires on some seeds and not on others.
    expect(seen).toEqual(new Set([true, false]));
  });

  it('with a score of 1 it always fires, whatever the seed', async () => {
    const workflow = graph(
      [node('input', 'chat-input'), node('trigger', 'trigger', { ...base }), node('output', 'chat-output')],
      [edge('trigger', 'true', 'output', 'value')],
    );
    for (const seed of ['a', 'b', 'c']) {
      const result = await play(workflow, seed);
      expect(result.replies.map((reply) => reply.content)).toEqual(['true']);
      expect(result.writes).toHaveLength(1);
    }
  });
});
