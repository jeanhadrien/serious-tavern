import { isPlainObject, parseDecimal } from '@st/shared';

// Pure helpers of the Trigger panel. The config is read defensively: it may be hand-edited or half-filled.

export const TRIGGER_LEVELS = [1, 2, 3, 4, 5] as const;
export type LevelField = 'cooldowns' | 'levelWeights';
export type SignalRow = { name: string; weight: number };

/** A number typed as text, from `min` up (a plain decimal), or undefined while it isn't one. */
export function parseAtLeast(text: string, min: number): number | undefined {
  const value = parseDecimal(text);
  return value !== undefined && value >= min ? value : undefined;
}

/** A number typed as text between 0 and 1, or undefined. */
export function parseUnit(text: string): number | undefined {
  const value = parseDecimal(text);
  return value !== undefined && value >= 0 && value <= 1 ? value : undefined;
}

/** A whole number of at least 0 typed as text, or undefined. */
export function parseTurns(text: string): number | undefined {
  const value = parseAtLeast(text, 0);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

/** A scalar setting: the config's number, else the node's default, else `fallback`. */
export function numberSetting(
  config: Record<string, unknown>,
  defaults: Record<string, unknown>,
  key: string,
  fallback = 0,
): number {
  const value = config[key] ?? defaults[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The value of one level of `cooldowns` or `levelWeights`: the config's, else the node's default for that level. */
export function levelSetting(
  config: Record<string, unknown>,
  defaults: Record<string, unknown>,
  field: LevelField,
  level: number,
): number {
  const own = config[field];
  const value = isPlainObject(own) && level in own ? own[String(level)] : undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const fallback = isPlainObject(defaults[field]) ? defaults[field][String(level)] : undefined;
  return typeof fallback === 'number' ? fallback : 0;
}

/** The config with one level changed; the other levels keep what the panel shows (their stored value or default). */
export function withLevel(
  config: Record<string, unknown>,
  defaults: Record<string, unknown>,
  field: LevelField,
  level: number,
  value: number,
): Record<string, unknown> {
  const levels = Object.fromEntries(
    TRIGGER_LEVELS.map((item) => [String(item), item === level ? value : levelSetting(config, defaults, field, item)]),
  );
  return { ...config, [field]: levels };
}

/** The signal rows as stored; anything that isn't a row with a text name and a number weight is shown as empty. */
export function signalRows(config: Record<string, unknown>): SignalRow[] {
  if (!Array.isArray(config.signals)) return [];
  return config.signals.map((row) => ({
    name: isPlainObject(row) && typeof row.name === 'string' ? row.name : '',
    weight: isPlainObject(row) && typeof row.weight === 'number' ? row.weight : 0,
  }));
}

export function withSignals(config: Record<string, unknown>, rows: SignalRow[]): Record<string, unknown> {
  return { ...config, signals: rows };
}

export const addSignal = (rows: SignalRow[]): SignalRow[] => [...rows, { name: '', weight: 0.5 }];
export const removeSignal = (rows: SignalRow[], index: number): SignalRow[] => rows.filter((_, i) => i !== index);
export const changeSignal = (rows: SignalRow[], index: number, patch: Partial<SignalRow>): SignalRow[] =>
  rows.map((row, i) => (i === index ? { ...row, ...patch } : row));

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** What is wrong with a signal name as typed (it becomes an input of the node); undefined when nothing is. */
export function signalNameHint(name: string, rows: readonly SignalRow[], index: number): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'Name the signal: it becomes an input of the node';
  if (!NAME.test(trimmed)) return 'Start with a letter; letters, digits and _ only';
  if (['volatility', 'maxLevel', 'value'].includes(trimmed)) return 'The node already has an input with this name';
  if (rows.some((row, i) => i !== index && row.name.trim() === trimmed)) return 'Another signal has this name';
  return undefined;
}
