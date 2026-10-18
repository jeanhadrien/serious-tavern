import type { CollectionKeyDef } from './definition.js';
import { isPlainObject } from './helpers.js';

/**
 * What the State nodes take and give, as one rule for the engine (which runs it), the node panels and the web
 * editors (which warn about it before a run): the read modes and collection items. `parseDecimal` (plain numbers
 * typed as text) is UI-side only: the panels and the definitions editor use it; the engine never parses text.
 */

/** The ways a State Read node reads a key: its value, or facts about when it was written. */
export const stateReads = ['value', 'meta'] as const;
export type StateRead = (typeof stateReads)[number];

const DECIMAL = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/**
 * A plain decimal number typed as text (`3`, `-2.5`, `1e3`): that number, or undefined for anything else, blank
 * included (callers decide what blank means). Hex, `Infinity` and the like are not numbers here.
 */
export function parseDecimal(text: string): number | undefined {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

type ItemFieldType = NonNullable<CollectionKeyDef['fields']>[string];

/** What a declared item field of each type has to be, in words ("must be a number"). */
export const itemFieldNeeds: Record<ItemFieldType, string> = {
  text: 'text',
  number: 'a number',
  boolean: 'true or false',
};

const fieldFits: Record<ItemFieldType, (value: unknown) => boolean> = {
  text: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  boolean: (value) => typeof value === 'boolean',
};

/** Why a value cannot be added as an item of a collection key. */
export type ItemProblem = { kind: 'shape' } | { kind: 'field'; name: string; type: ItemFieldType; value: unknown };

export type ItemFit =
  | { problem: ItemProblem }
  | { problem?: undefined; item: { text: string } & Record<string, unknown>; ignored: string[] };

/**
 * The item an `add` stores for `value`: text, or an object with a `text` string. Only the key's declared fields
 * survive, each of the declared type (`ignored` names the other fields of an object); a field that is absent or
 * undefined is left out, one of the wrong type is the problem.
 */
export function collectionItem(def: CollectionKeyDef, value: unknown): ItemFit {
  if (typeof value === 'string') return { item: { text: value }, ignored: [] };
  if (!isPlainObject(value) || typeof value.text !== 'string') return { problem: { kind: 'shape' } };
  const declared = def.fields ?? {};
  const item: { text: string } & Record<string, unknown> = { text: value.text };
  for (const [name, type] of Object.entries(declared)) {
    const field = Object.hasOwn(value, name) ? value[name] : undefined;
    if (field === undefined) continue;
    if (!fieldFits[type](field)) return { problem: { kind: 'field', name, type, value: field } };
    item[name] = field;
  }
  const ignored = Object.keys(value).filter((name) => name !== 'text' && !Object.hasOwn(declared, name));
  return { item, ignored };
}
