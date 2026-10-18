import { describeValue } from '../text.js';

/**
 * A number given to a node input: a finite number, or text holding one (enum chat settings store text). Anything
 * else is a plain error naming the input, e.g. `Max level must be a number, got "abc"`.
 */
export function numberInput(label: string, value: unknown): number {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof number === 'number' && Number.isFinite(number)) return number;
  throw new Error(
    `${label} must be a number, got ${typeof value === 'string' ? `"${value.slice(0, 40)}"` : describeValue(value)}`,
  );
}
