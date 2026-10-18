import type { PortDef } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { numberInput } from '../number-input.js';
import { configSchema, defaultConfig, signalPorts, type TriggerConfig } from './config.js';
import { decide } from './decide.js';
import { readFirings, TRIGGER_STATE_KEY } from './fires.js';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const inputs: PortDef[] = [
  {
    name: 'volatility',
    label: 'Volatility',
    dataType: 'number',
    requiredIfConnected: true,
    description: 'Overrides Volatility, 0 to 1 (clamped); numeric text such as a chat setting is accepted',
  },
  {
    name: 'maxLevel',
    label: 'Max level',
    dataType: 'number',
    requiredIfConnected: true,
    description: 'Overrides Max level; a level fires only when it is at most this',
  },
  {
    name: 'value',
    label: 'Value',
    dataType: 'any',
    requiredIfConnected: true,
    description: 'Passed to the True or False output, whichever is taken',
  },
];

const outputs: PortDef[] = [
  { name: 'fire', label: 'Fire', dataType: 'boolean', description: 'Whether to inject this turn' },
  {
    name: 'level',
    label: 'Level',
    dataType: 'number',
    optional: true,
    description: 'How strongly, 1 to 5; absent when it does not fire',
  },
  { name: 'true', label: 'True', dataType: 'any', optional: true, description: 'Taken when it fires' },
  { name: 'false', label: 'False', dataType: 'any', optional: true, description: 'Taken when it does not fire' },
  { name: 'score', label: 'Score', dataType: 'number', description: 'The chance of firing this turn, 0 to 1' },
  { name: 'roll', label: 'Roll', dataType: 'number', description: 'The raw draw in [0, 1); it fires below the score' },
  { name: 'reason', label: 'Reason', dataType: 'text', description: 'The score, the roll and the level, in words' },
];

/**
 * Decides WHETHER to inject this turn and HOW STRONGLY; Draw or Recall decide what and the preset decides the
 * wording. Score = clamp01((baseChance + growthPerTurn × turns since the last firing + Σ weight × signal) × (0.5 +
 * volatility)); it fires when the roll is below the score and a level is available (see `decide`). The firings are
 * remembered as implicit story state under the node's own `fires` key, so deleting the reply undoes one.
 */
export const trigger: NodeDefinition = {
  type: 'trigger',
  label: 'Trigger',
  description:
    'Decides whether to inject something this turn and how strongly (level 1 to 5). Score = (base chance + growth × turns since the last firing + Σ signal weight × signal) × (0.5 + volatility); it fires when a roll is below the score and a level is off cooldown. Draw or Recall choose what; the preset words it',
  category: 'Creativity',
  inputs,
  outputs,
  configSchema,
  defaultConfig,
  async resolvePorts(config) {
    return { inputs: [...inputs, ...signalPorts(config)], outputs };
  },
  async execute(ctx) {
    const config = ctx.config as TriggerConfig;
    // The three fixed inputs are requiredIfConnected: present here means connected, so a skipped source skips the node.
    const volatility = Object.hasOwn(ctx.inputs, 'volatility')
      ? clamp01(numberInput('Volatility', ctx.inputs.volatility))
      : config.volatility;
    const maxLevel = Object.hasOwn(ctx.inputs, 'maxLevel')
      ? numberInput('Max level', ctx.inputs.maxLevel)
      : config.maxLevel;
    // A signal that is not connected (or whose source was skipped) counts as 0.
    const signals = config.signals.map(({ name, weight }) => ({
      name,
      weight,
      value: Object.hasOwn(ctx.inputs, name) ? clamp01(numberInput(`Signal "${name}"`, ctx.inputs[name])) : 0,
    }));
    const decision = decide(
      {
        turn: ctx.state.turn,
        baseChance: config.baseChance,
        growthPerTurn: config.growthPerTurn,
        volatility,
        maxLevel,
        cooldowns: config.cooldowns,
        levelWeights: config.levelWeights,
        signals,
        firings: readFirings(ctx.state.own(TRIGGER_STATE_KEY)),
      },
      ctx.random,
    );
    if (decision.fire)
      ctx.writeState({
        target: { kind: 'node', key: TRIGGER_STATE_KEY },
        op: 'add',
        item: { text: `fired at level ${decision.level}`, level: decision.level },
      });
    const passed = Object.hasOwn(ctx.inputs, 'value') ? ctx.inputs.value : decision.fire;
    return {
      fire: decision.fire,
      ...(decision.fire && { level: decision.level }),
      [String(decision.fire)]: passed,
      score: decision.score,
      roll: decision.roll,
      reason: decision.reason,
    };
  },
};
