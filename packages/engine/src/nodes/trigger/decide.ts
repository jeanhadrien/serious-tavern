import { LEVELS } from './config.js';
import type { Firing } from './fires.js';

export type TriggerParams = {
  /** The turn being run (1-based). */
  turn: number;
  baseChance: number;
  growthPerTurn: number;
  /** 0..1 */
  volatility: number;
  maxLevel: number;
  cooldowns: Record<string, number>;
  levelWeights: Record<string, number>;
  /** `value` is already clamped to 0..1. */
  signals: { name: string; weight: number; value: number }[];
  /** Earlier firings, newest first. */
  firings: readonly Firing[];
};

export type TriggerDecision = { fire: boolean; level?: number; score: number; roll: number; reason: string };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** At most three decimals, no trailing zeros: 0.296, 0.1, 3. */
const fmt = (value: number) => String(Number(value.toFixed(3)));

const turnsText = (count: number) => `${count} more turn${count === 1 ? '' : 's'}`;

/**
 * The score of a turn: `clamp01((baseChance + growthPerTurn × turnsSinceLastFiring + Σ weight × signal) × (0.5 +
 * volatility))`. Never fired counts as `turn` turns since the last firing.
 */
export function triggerScore(params: TriggerParams): { score: number; raw: number; since: number; terms: string[] } {
  const last = params.firings.reduce((newest, { turn }) => Math.max(newest, turn), 0);
  const since = Math.max(0, params.turn - last);
  const parts = [
    { sign: 1, text: fmt(params.baseChance) },
    { sign: 1, text: `${fmt(params.growthPerTurn)}×${since}` },
    ...params.signals.map(({ name, weight, value }) => ({
      sign: weight < 0 ? -1 : 1,
      text: `${fmt(Math.abs(weight))}×${fmt(value)} ${name}`,
    })),
  ];
  const terms = parts.map((part, index) => (index === 0 ? part.text : `${part.sign < 0 ? '-' : '+'} ${part.text}`));
  const sum =
    params.baseChance +
    params.growthPerTurn * since +
    params.signals.reduce((total, { weight, value }) => total + weight * value, 0);
  const raw = sum * (0.5 + params.volatility);
  return { score: clamp01(raw), raw, since, terms };
}

/**
 * Decides whether to fire and at which level. One `random()` draw for the roll, always, and one more for the level
 * only when it fires, so the same seed gives the same outcome. A level is available when it is within `maxLevel`,
 * off cooldown (`turn - its last firing >= its cooldown`) and has a weight above 0.
 */
export function decide(params: TriggerParams, random: () => number): TriggerDecision {
  const { score, raw, terms } = triggerScore(params);
  const roll = random();
  const factor = 0.5 + params.volatility;
  const shown = score === raw ? fmt(score) : `${fmt(score)} (capped from ${fmt(raw)})`;
  const head = `score ${shown} = (${terms.join(' ')}) × ${fmt(factor)}`;

  const available: { level: number; weight: number }[] = [];
  const cooling: string[] = [];
  const weightless: string[] = [];
  for (const level of LEVELS) {
    if (level > params.maxLevel) continue;
    const lastAt = params.firings.find((firing) => firing.level === level)?.turn;
    const wait = lastAt === undefined ? 0 : (params.cooldowns[level] ?? 0) - (params.turn - lastAt);
    const weight = params.levelWeights[level] ?? 0;
    if (wait > 0) cooling.push(`level ${level} on cooldown for ${turnsText(wait)}`);
    else if (!(weight > 0)) weightless.push(`level ${level} has weight 0`);
    else available.push({ level, weight });
  }
  const above = params.maxLevel < LEVELS.at(-1)! ? [`levels above max level ${fmt(params.maxLevel)} left out`] : [];
  const notes = (...lists: string[][]) => (lists.flat().length ? ` (${lists.flat().join('; ')})` : '');

  if (!(roll < score))
    return { fire: false, score, roll, reason: `${head}; roll ${fmt(roll)} ≥ ${fmt(score)}: no firing` };
  if (!available.length)
    return {
      fire: false,
      score,
      roll,
      reason: `${head}; roll ${fmt(roll)} < ${fmt(score)} but no level can fire${notes(cooling, weightless, above)}`,
    };
  const total = available.reduce((sum, { weight }) => sum + weight, 0);
  const target = random() * total;
  let cumulative = 0;
  let level = available.at(-1)!.level;
  for (const option of available) {
    cumulative += option.weight;
    if (target < cumulative) {
      level = option.level;
      break;
    }
  }
  return {
    fire: true,
    level,
    score,
    roll,
    reason: `${head}; roll ${fmt(roll)} < ${fmt(score)}; level ${level} chosen${notes(cooling, above)}`,
  };
}
