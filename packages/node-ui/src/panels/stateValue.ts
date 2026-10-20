// Pure helpers of the State Write panel's typed fixed-value editor. A key's type and the chosen operation decide
// what kind of value the node can store; the operations themselves come from the shared `stateOpsFor`.
import {
  collectionItem,
  isPlainObject,
  itemFieldNeeds,
  keyValueProblem,
  parseDecimal,
  type CollectionKeyDef,
  type ScalarKeyDef,
  type StateKeyDef,
  type StateNodeOp,
} from '@st/shared';

export type ValueKind = 'none' | 'number' | 'amount' | 'boolean' | 'enum' | 'text' | 'object' | 'item' | 'itemId';

/** What the fixed value of an operation on a key is: a kind of editor, or `none` (a reset needs no value). */
export function valueKind(def: StateKeyDef, op: StateNodeOp): ValueKind {
  if (op === 'delete') return 'none';
  switch (def.type) {
    case 'number':
      return op === 'set' ? 'number' : op === 'increment' ? 'amount' : 'none';
    case 'collection':
      return op === 'add' ? 'item' : op === 'remove' ? 'itemId' : 'none';
    case 'thread':
      // An exchange comes from an LLM node's Exchange output, never from a fixed value.
      return op === 'remove' ? 'itemId' : 'none';
    default:
      return op === 'set' ? def.type : 'none';
  }
}

/** Blank is `null` (no value); a plain decimal number is that number; anything else is `undefined` (invalid). */
export function parseNumber(text: string): number | null | undefined {
  return text.trim() ? parseDecimal(text) : null;
}

/** Blank is `null` (no value); a JSON object is that object; anything else is `undefined` (invalid). */
export function parseObject(text: string): Record<string, unknown> | null | undefined {
  if (!text.trim()) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isPlainObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

type ItemParts = { text: string; fields: Record<string, unknown> };

/** The pieces of a stored item value (text, or an object with a text field) as the editor shows them. */
export function itemParts(value: unknown, def: CollectionKeyDef): ItemParts {
  if (typeof value === 'string') return { text: value, fields: {} };
  if (!isPlainObject(value)) return { text: '', fields: {} };
  const declared = Object.keys(def.fields ?? {}).filter((name) => Object.hasOwn(value, name));
  return {
    text: typeof value.text === 'string' ? value.text : '',
    fields: Object.fromEntries(declared.map((name) => [name, value[name]])),
  };
}

/**
 * The item value for the pieces: nothing when all are blank, just the text when that is all there is, else an
 * object with the text and the declared fields that are set. Fields of `previous` that the key does not declare
 * stay (a hand-edited value keeps what it had).
 */
export function itemValue(parts: ItemParts, def: CollectionKeyDef, previous?: unknown): unknown {
  const declared = def.fields ?? {};
  const set = Object.fromEntries(
    Object.keys(declared)
      .map((name) => [name, parts.fields[name]] as const)
      .filter(([, value]) => value !== undefined && value !== ''),
  );
  if (!parts.text && !Object.keys(set).length) return undefined;
  const kept = isPlainObject(previous)
    ? Object.fromEntries(Object.entries(previous).filter(([name]) => name !== 'text' && !Object.hasOwn(declared, name)))
    : {};
  if (!Object.keys(set).length && !Object.keys(kept).length) return parts.text;
  return { ...kept, text: parts.text, ...set };
}

/** Where a number key's values stay, for the hint under a number or amount field. */
export function boundsHint(def: StateKeyDef): string | undefined {
  if (def.type !== 'number' || (def.min === undefined && def.max === undefined)) return undefined;
  const range =
    def.min !== undefined && def.max !== undefined
      ? `between ${def.min} and ${def.max}`
      : def.min !== undefined
        ? `at least ${def.min}`
        : `at most ${def.max}`;
  return `The key stays ${range}: a value outside is clamped.`;
}

/**
 * Why the node's fixed value would fail when it runs, in plain words; undefined when it fits (or there is none,
 * or the operation ignores it). Mirrors what State Write checks at run time: numbers are clamped, never refused.
 */
export function fixedValueProblem(def: StateKeyDef, op: StateNodeOp, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  switch (valueKind(def, op)) {
    case 'none':
      return undefined;
    case 'number':
    case 'amount':
      return typeof value === 'number' && Number.isFinite(value) ? undefined : 'The fixed value is not a number';
    case 'item': {
      // The node's own rule (shared with the engine), so the panel warns about exactly what a run would refuse.
      const { problem } = collectionItem(def as CollectionKeyDef, value);
      if (problem?.kind === 'shape') return 'The fixed item must be text, or an object with a text field';
      return problem ? `The fixed item's field "${problem.name}" must be ${itemFieldNeeds[problem.type]}` : undefined;
    }
    case 'itemId':
      return typeof value === 'string' && value.trim() ? undefined : 'The fixed item id must be text';
    default: {
      const problem = keyValueProblem(def as ScalarKeyDef, value);
      return problem ? `The fixed value ${problem}` : undefined;
    }
  }
}

/**
 * The config after the user picks an operation. Another operation takes another kind of value, so the fixed
 * `value` goes.
 */
export const pickOp = (config: Record<string, unknown>, op: string): Record<string, unknown> =>
  withFixedValue({ ...config, op }, undefined);

/**
 * The config with its fixed `value` set. No value (undefined or null) removes the setting: it is never stored as
 * an empty text, which would be a value (and for a number key a run-time error).
 */
export function withFixedValue(config: Record<string, unknown>, value: unknown): Record<string, unknown> {
  const { value: _previous, ...rest } = config;
  return value === undefined || value === null ? rest : { ...rest, value };
}
