import { z } from 'zod';
import type { PortDef } from '@st/shared';

export const LEVELS = [1, 2, 3, 4, 5] as const;

/** Minimum turns between two firings at the same level. */
export const DEFAULT_COOLDOWNS: Record<string, number> = { '1': 0, '2': 2, '3': 4, '4': 8, '5': 15 };
/** Relative chance of each level when the Trigger fires. */
export const DEFAULT_LEVEL_WEIGHTS: Record<string, number> = { '1': 5, '2': 3, '3': 2, '4': 1, '5': 0.5 };

type Signal = { name: string; weight: number };
export type TriggerConfig = {
  baseChance: number;
  growthPerTurn: number;
  volatility: number;
  maxLevel: number;
  cooldowns: Record<string, number>;
  levelWeights: Record<string, number>;
  signals: Signal[];
};

// Inputs the node has itself: a signal can't take their names.
const RESERVED_NAMES = ['volatility', 'maxLevel', 'value'];

/** Why a signal name can't be a port name (plain words); undefined when it can. */
export function signalNameProblem(name: string): string | undefined {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))
    return `Signal name "${name}" must start with a letter and use only letters, digits and _`;
  if (RESERVED_NAMES.includes(name)) return `Signal name "${name}" is already an input of the node; pick another`;
  return undefined;
}

// Every level has its own default, so a partly filled hand-edited object stays valid.
const perLevel = (schema: z.ZodNumber, defaults: Record<string, number>) =>
  z
    .object(Object.fromEntries(LEVELS.map((level) => [String(level), schema.default(defaults[String(level)]!)])))
    .default(defaults);

const unit = (label: string) =>
  z.number().min(0, `${label} must be between 0 and 1`).max(1, `${label} must be between 0 and 1`);

export const configSchema = z
  .object({
    baseChance: unit('Base chance')
      .default(0.1)
      .describe('Chance of firing on a turn right after a firing, before signals'),
    growthPerTurn: z
      .number()
      .min(0, 'Growth per turn can not be negative')
      .default(0.05)
      .describe('Added to the chance for every turn since the last firing (any level)'),
    volatility: unit('Volatility')
      .default(0.3)
      .describe('Scales the whole score by 0.5 + volatility; the Volatility input overrides it'),
    maxLevel: z
      .number()
      .int()
      .min(1, 'Max level goes from 1 to 5')
      .max(5, 'Max level goes from 1 to 5')
      .default(2)
      .describe('Highest level that can fire; the Max level input overrides it'),
    cooldowns: perLevel(z.number().int().min(0, 'A cooldown can not be negative'), DEFAULT_COOLDOWNS),
    levelWeights: perLevel(z.number().min(0, 'A level weight can not be negative'), DEFAULT_LEVEL_WEIGHTS),
    signals: z
      .array(z.object({ name: z.string().trim().min(1, 'Name every signal or remove its row'), weight: z.number() }))
      .default([]),
  })
  .superRefine((config, issues) => {
    const seen = new Set<string>();
    config.signals.forEach(({ name }, index) => {
      const problem = name && signalNameProblem(name);
      if (problem) issues.addIssue({ code: 'custom', path: ['signals', index, 'name'], message: problem });
      else if (seen.has(name))
        issues.addIssue({
          code: 'custom',
          path: ['signals', index, 'name'],
          message: `Signal "${name}" is listed twice`,
        });
      seen.add(name);
    });
  });

export const defaultConfig: Record<string, unknown> = {
  baseChance: 0.1,
  growthPerTurn: 0.05,
  volatility: 0.3,
  maxLevel: 2,
  cooldowns: DEFAULT_COOLDOWNS,
  levelWeights: DEFAULT_LEVEL_WEIGHTS,
  signals: [],
};

/**
 * One `number` input per named signal. Reads the config defensively (editor port requests send it unparsed): rows
 * without a name yet are ignored, a mistaken or repeated name is a plain error.
 */
export function signalPorts(config: Record<string, unknown>): PortDef[] {
  const rows = Array.isArray(config.signals) ? config.signals : [];
  const seen = new Set<string>();
  const ports: PortDef[] = [];
  for (const row of rows as { name?: unknown; weight?: unknown }[]) {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    const problem = signalNameProblem(name);
    if (problem) throw new Error(problem);
    if (seen.has(name)) throw new Error(`Signal "${name}" is listed twice`);
    seen.add(name);
    ports.push({
      name,
      label: name,
      dataType: 'number',
      description: `A signal from 0 to 1 (weight ${typeof row.weight === 'number' ? row.weight : '?'}): adds weight × signal to the score. Not connected counts as 0`,
    });
  }
  return ports;
}
