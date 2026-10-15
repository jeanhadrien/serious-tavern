import { z } from 'zod';
import type { PortDef } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { describeValue } from '../../text.js';

const modes = ['number', 'integer', 'pick', 'chance'] as const;
type Mode = (typeof modes)[number];
// Bounds used when min or max is left blank; they differ per mode, so the config has no zod default.
const defaultBounds = { number: [0, 1], integer: [1, 6] } as const;

const roll: PortDef = { name: 'roll', label: 'Roll', dataType: 'number', description: 'The raw draw in [0, 1)' };
const ports: Record<Mode, { inputs: PortDef[]; outputs: PortDef[] }> = {
  number: {
    inputs: [],
    outputs: [{ name: 'value', label: 'Value', dataType: 'number', description: 'Number from min up to max' }, roll],
  },
  integer: {
    inputs: [],
    outputs: [
      { name: 'value', label: 'Value', dataType: 'number', description: 'Whole number from min to max, both included' },
      roll,
    ],
  },
  pick: {
    inputs: [
      {
        name: 'items',
        label: 'Items',
        dataType: 'array',
        required: true,
        description: 'List to pick from; object items may carry a numeric weight',
      },
    ],
    outputs: [
      {
        name: 'value',
        label: 'Value',
        dataType: 'any',
        optional: true,
        description: 'The picked item; absent when nothing can be picked',
      },
      roll,
    ],
  },
  chance: {
    inputs: [
      {
        name: 'probability',
        label: 'Probability',
        dataType: 'number',
        requiredIfConnected: true,
        description: 'Chance of true, 0 to 1; overrides the configured probability',
      },
      {
        name: 'value',
        label: 'Value',
        dataType: 'any',
        requiredIfConnected: true,
        description: 'Passed to the branch that is taken',
      },
    ],
    outputs: [
      { name: 'value', label: 'Result', dataType: 'boolean', description: 'Whether the chance came up' },
      { name: 'true', label: 'True', dataType: 'any', optional: true, description: 'Taken when the result is true' },
      { name: 'false', label: 'False', dataType: 'any', optional: true, description: 'Taken when the result is false' },
      roll,
    ],
  },
};

const bounds = (config: { mode: Mode; min?: number; max?: number }) => {
  const [min, max] = config.mode === 'integer' ? defaultBounds.integer : defaultBounds.number;
  return [config.min ?? min, config.max ?? max] as const;
};

/** Weight of a pick item: its numeric weight field, otherwise 1. Not finite or <= 0 means never picked. */
function weightOf(item: unknown, weightField: string): number {
  if (!weightField || item === null || typeof item !== 'object' || Array.isArray(item)) return 1;
  const weight = (item as Record<string, unknown>)[weightField];
  if (typeof weight !== 'number') return 1;
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

function pick(items: unknown[], weightField: string, draw: number): { value?: unknown } {
  const weighted = items.map((item) => ({ item, weight: weightOf(item, weightField) }));
  const eligible = weighted.filter((entry) => entry.weight > 0);
  const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
  if (!eligible.length || !Number.isFinite(total)) return {};
  const target = draw * total;
  let cumulative = 0;
  for (const entry of eligible) {
    cumulative += entry.weight;
    if (target < cumulative) return { value: entry.item };
  }
  // Guard only: the sums above add the same weights in the same order, and draws stay below 1.
  return { value: eligible.at(-1)!.item };
}

export const random: NodeDefinition = {
  type: 'random',
  label: 'Random',
  description: 'Roll a number, pick from a list, or flip a weighted coin',
  category: 'Logic',
  inputs: ports.number.inputs,
  outputs: ports.number.outputs,
  configSchema: z
    .object({
      mode: z.enum(modes).default('number'),
      min: z.number().optional().describe('Blank: 0 in number mode, 1 in integer mode'),
      max: z.number().optional().describe('Blank: 1 in number mode, 6 in integer mode'),
      weightField: z
        .string()
        .default('weight')
        .describe('Pick mode: object items with this numeric field are weighted; blank: no weights'),
      probability: z
        .number()
        .min(0, 'Probability must be between 0 and 1')
        .max(1, 'Probability must be between 0 and 1')
        .default(0.5)
        .describe('Chance mode: chance of true when the probability input is not connected'),
    })
    .superRefine((config, issues) => {
      if (config.mode !== 'number' && config.mode !== 'integer') return;
      const [min, max] = bounds(config);
      if (config.mode === 'integer' && (!Number.isInteger(min) || !Number.isInteger(max)))
        issues.addIssue({
          code: 'custom',
          path: [Number.isInteger(min) ? 'max' : 'min'],
          message: 'Integer mode needs whole numbers for min and max',
        });
      if (min > max) issues.addIssue({ code: 'custom', path: ['max'], message: 'Max must be at least min' });
    }),
  defaultConfig: { mode: 'number', weightField: 'weight', probability: 0.5 },
  // The config may be unparsed here (editor port requests, edge pruning), so read the mode defensively.
  async resolvePorts(config) {
    const mode = config.mode ?? 'number';
    if (!modes.includes(mode as Mode)) throw new Error(`Unknown mode "${String(mode)}"`);
    return ports[mode as Mode];
  },
  async execute(ctx) {
    const config = ctx.config as { mode: Mode; min?: number; max?: number; weightField: string; probability: number };
    // Exactly one draw per run in every mode, so `roll` tells the whole story.
    const draw = ctx.random();
    switch (config.mode) {
      case 'number': {
        const [min, max] = bounds(config);
        return { value: min + draw * (max - min), roll: draw };
      }
      case 'integer': {
        const [min, max] = bounds(config);
        return { value: min + Math.floor(draw * (max - min + 1)), roll: draw };
      }
      case 'pick': {
        const items = ctx.inputs.items;
        if (!Array.isArray(items)) throw new Error(`Items must be a list, got ${describeValue(items)}`);
        return { ...pick(items, config.weightField, draw), roll: draw };
      }
      case 'chance': {
        // Both inputs are requiredIfConnected: present here means connected, so a skipped source skips the node.
        const probability = Object.hasOwn(ctx.inputs, 'probability') ? ctx.inputs.probability : config.probability;
        if (typeof probability !== 'number' || !Number.isFinite(probability))
          throw new Error(`Probability must be a number, got ${describeValue(probability)}`);
        // A connected score may overshoot a little; the configured value is validated up front.
        const result = draw < Math.min(1, Math.max(0, probability));
        const passed = Object.hasOwn(ctx.inputs, 'value') ? ctx.inputs.value : result;
        return { value: result, [String(result)]: passed, roll: draw };
      }
      default:
        throw new Error(`Unknown mode "${String(config.mode)}"`);
    }
  },
};
