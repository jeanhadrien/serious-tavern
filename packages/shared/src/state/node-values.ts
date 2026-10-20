import { conversationMessageSchema, exchangeText, type ConversationMessage } from '../conversation/message.js';
import type { CollectionKeyDef, StateKeyType } from './definition.js';
import { isPlainObject } from './helpers.js';

/**
 * What the State nodes take and give, as one rule for the engine (which runs it), the node panels and the web
 * editors (which warn about it before a run): the read modes and collection items. `parseDecimal` (plain numbers
 * typed as text) is UI-side only: the panels and the definitions editor use it; the engine never parses text.
 */

/**
 * The ways a State Read node reads a key: its value, facts about when it was written, or (collections only) the
 * items that link to chat messages and are still intact, in chat order.
 */
export const stateReads = ['value', 'meta', 'linked'] as const;
export type StateRead = (typeof stateReads)[number];

/** The reads a key type has: every one for a collection, `linked` makes no sense for the others. */
export function stateReadsFor(type: StateKeyType): StateRead[] {
  return type === 'collection' ? [...stateReads] : stateReads.filter((read) => read !== 'linked');
}

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

/**
 * Item properties that belong to the system: the link a State Write `messages` input sets (stored) and the `link` a
 * run's snapshot computes for items that have one (never stored). New definition writes cannot declare fields with
 * these names. Only `messages` is protected when an item is stored: a value's own `messages` is never kept, even when
 * an old definition declares such a field. A field called `link` that an existing definition declares keeps its value
 * (nothing is dropped from data the user declared); on an item that has `messages` a run reads the computed `link`
 * instead of it.
 */
export const RESERVED_ITEM_FIELDS: ReadonlySet<string> = new Set(['messages', 'link']);
const STORED_BUILT_IN = 'messages';

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
  const declared = Object.fromEntries(Object.entries(def.fields ?? {}).filter(([name]) => name !== STORED_BUILT_IN));
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

/** What a thread item holds, before the engine stamps `id`, `turnId` and `runId` on it. */
export type ThreadItemBody = { text: string; exchange: ConversationMessage[]; input?: ConversationMessage };

export type ThreadFit = { problem: string } | { problem?: undefined; item: ThreadItemBody };

/** A message without the fields only a backend replay needs (`reasoning`, `provider_data`). */
function withoutReplayData(message: ConversationMessage): ConversationMessage {
  const { reasoning: _reasoning, provider_data: _data, ...rest } = message;
  return rest;
}

/**
 * The user side of an exchange: text (a user message) or one message (only its role, content and name are kept, so a
 * chat message does not bring its bookkeeping along); blank text means there is none.
 */
function threadInput(input: unknown): { input?: ConversationMessage; problem?: string } {
  if (input === undefined || input === null) return {};
  if (typeof input === 'string') return input.trim() ? { input: { role: 'user', content: input } } : {};
  const parsed = conversationMessageSchema.safeParse(input);
  if (!parsed.success) return { problem: 'the input to be text or one message' };
  const { role, content, name } = parsed.data;
  return { input: { role, content, ...(name !== undefined && { name }) } };
}

/**
 * The item an `add` stores in a thread key: `value` must be a non-empty list of canonical messages (an LLM node's
 * `exchange`), `input` an optional text (stored as a `user` message) or one message. `reasoning` and `provider_data` are
 * left out unless `keepReasoning`; `provenance` always stays. `text` is the exchange's final answer. A problem is
 * a plain-language phrase to follow the key's name ("<key> needs ...").
 */
export function threadItem(value: unknown, input?: unknown, options: { keepReasoning?: boolean } = {}): ThreadFit {
  if (!Array.isArray(value)) return { problem: 'a list of messages (the exchange of an LLM node)' };
  if (value.length === 0) return { problem: 'at least one message in the exchange' };
  const exchange: ConversationMessage[] = [];
  for (const [index, entry] of value.entries()) {
    const parsed = conversationMessageSchema.safeParse(entry);
    if (!parsed.success)
      return { problem: `messages only, but message ${index + 1} is not valid: ${parsed.error.issues[0]?.message}` };
    exchange.push(options.keepReasoning ? parsed.data : withoutReplayData(parsed.data));
  }
  const given = threadInput(input);
  if (given.problem) return { problem: given.problem };
  return {
    item: {
      text: exchangeText(exchange),
      exchange: structuredClone(exchange),
      ...(given.input && { input: given.input }),
    },
  };
}
