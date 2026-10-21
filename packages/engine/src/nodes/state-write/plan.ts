import {
  clampToKey,
  collectionItem,
  exchangeSummary,
  incrementedValue,
  itemFieldNeeds,
  isPlainObject,
  keyDefault,
  keyValueProblem,
  type CollectionKeyDef,
  type ItemLink,
  type NumberKeyDef,
  type ScalarKeyDef,
  type StateNodeOp,
  threadItem,
} from '@st/shared';
import { describeValue } from '../../text.js';
import type { StateWriteRequest } from '../../types.js';
import { shown, type LocatedKey } from '../state-key.js';
import { checkOp } from './ports.js';

/** What a State Write node will do: the request to buffer, what it outputs, and lines for the node log. */
export type WritePlan = {
  /** Absent when there is nothing to store (removing an id the key doesn't hold). */
  request?: StateWriteRequest;
  /** The `value` output. An `add` outputs the stored item (with its id) instead, which only the buffer knows. */
  output?: unknown;
  logs: string[];
};

const quoted = (value: unknown) => (typeof value === 'string' ? `"${value.slice(0, 40)}"` : describeValue(value));

/** The new value of a number key; numbers outside min..max are clamped, not refused. */
function planNumber(found: LocatedKey & { def: NumberKeyDef }, op: StateNodeOp, ctx: Inputs): WritePlan {
  const { label, def } = found;
  const given = op === 'increment' && !ctx.connected ? 1 : ctx.value;
  if (op === 'delete') return planDelete(found, ctx);
  if (typeof given !== 'number' || !Number.isFinite(given))
    throw new Error(`${label} needs a number, got ${describeValue(given)}`);
  const key = { kind: 'definition' as const, definitionId: found.definition.id, key: found.key };
  if (op === 'increment') {
    const next = incrementedValue(def, ctx.current, given);
    return {
      request: { target: key, op: 'increment', by: given },
      output: next,
      logs: [`${label}: ${shown(typeof ctx.current === 'number' ? ctx.current : keyDefault(def))} -> ${shown(next)}`],
    };
  }
  const next = clampToKey(def, given);
  return {
    request: { target: key, op: 'set', value: next },
    output: next,
    logs: [
      `${label}: ${shown(ctx.current)} -> ${shown(next)}${next === given ? '' : ` (${given} clamped to the key's bounds)`}`,
    ],
  };
}

function planScalar(found: LocatedKey & { def: ScalarKeyDef }, ctx: Inputs): WritePlan {
  const { label, def } = found;
  const problem = keyValueProblem(def, ctx.value);
  if (problem) {
    const got = ctx.value;
    switch (def.type) {
      case 'boolean':
        throw new Error(`${label} needs true or false, got ${describeValue(got)}`);
      case 'enum':
        throw new Error(`${label} must be one of: ${def.options.join(', ')}; got ${quoted(got)}`);
      case 'text':
        throw new Error(`${label} needs text, got ${describeValue(got)}`);
      default:
        throw new Error(`${label} needs an object, got ${describeValue(got)}`);
    }
  }
  const value = structuredClone(ctx.value);
  return {
    request: { target: keyOf(found), op: 'set', value },
    output: structuredClone(value),
    logs: [`${label}: ${shown(ctx.current)} -> ${shown(value)}`],
  };
}

const keyOf = (found: LocatedKey) => ({
  kind: 'definition' as const,
  definitionId: found.definition.id,
  key: found.key,
});

function planDelete(found: LocatedKey, ctx: Inputs): WritePlan {
  const output = keyDefault(found.def);
  return {
    request: { target: keyOf(found), op: 'delete' },
    output,
    logs: [`${found.label}: ${shown(ctx.current)} -> reset to ${shown(output)}`],
  };
}

type Inputs = {
  connected: boolean;
  value: unknown;
  current: unknown;
  /** The link a connected `messages` input stands for (an `add` only); parsed by the caller. */
  link?: ItemLink;
  /** A thread `add`: the connected `input` (text or a message), and whether the exchange keeps its reasoning. */
  input?: unknown;
  keepReasoning?: boolean;
};

/** The item an `add` stores (see `collectionItem`), or an error that says what is wrong with the value. */
function itemOf({ label, def }: LocatedKey & { def: CollectionKeyDef }, value: unknown) {
  const fit = collectionItem(def, value);
  if (fit.problem?.kind === 'shape')
    throw new Error(`${label} can only add text or an object with a text field, got ${describeValue(value)}`);
  if (fit.problem)
    throw new Error(
      `${label}: field "${fit.problem.name}" must be ${itemFieldNeeds[fit.problem.type]}, got ${describeValue(fit.problem.value)}`,
    );
  return fit;
}

function planCollection(found: LocatedKey & { def: CollectionKeyDef }, op: StateNodeOp, ctx: Inputs): WritePlan {
  const { label } = found;
  if (op === 'delete') return planDelete(found, ctx);
  if (op === 'add') {
    const { item, ignored } = itemOf(found, ctx.value);
    const { link } = ctx;
    return {
      request: { target: keyOf(found), op: 'add', item: link ? { ...item, messages: link } : item },
      logs: [
        `${label}: adding ${shown(item.text, 80)}${link ? ` (linked to ${link.ids.length === 1 ? '1 message' : `${link.ids.length} messages`})` : ''}`,
        ...(ignored.length ? [`Left out fields the key doesn't declare: ${ignored.join(', ')}`] : []),
      ],
    };
  }
  return planRemove(found, ctx);
}

// Removing an item by id: what a list key (collection or thread) does for `remove`.
function planRemove(found: LocatedKey, ctx: Inputs): WritePlan {
  const { label } = found;
  const id = ctx.value;
  if (typeof id !== 'string' || !id.trim())
    throw new Error(`${label} needs the id of the item to remove, got ${describeValue(id)}`);
  const held = Array.isArray(ctx.current) ? ctx.current : [];
  const removed = held.find((item) => isPlainObject(item) && item.id === id);
  if (!removed) return { logs: [`${label}: no item has the id ${shown(id, 80)}; nothing removed`] };
  return {
    request: { target: keyOf(found), op: 'remove', itemId: id },
    output: structuredClone(removed),
    logs: [`${label}: removing ${shown(id, 80)}`],
  };
}

/** A thread key stores whole exchanges: `add` takes an LLM node's `exchange` (see `threadItem`), the rest is as for a collection. */
function planThread(found: LocatedKey, op: StateNodeOp, ctx: Inputs): WritePlan {
  const { label } = found;
  if (op === 'delete') return planDelete(found, ctx);
  if (op !== 'add') return planRemove(found, ctx);
  const fit = threadItem(ctx.value, ctx.input, { keepReasoning: ctx.keepReasoning });
  if (fit.problem !== undefined)
    throw new Error(
      `${label} needs ${fit.problem}${Array.isArray(ctx.value) ? '' : `, got ${describeValue(ctx.value)}`}`,
    );
  const { steps, toolCalls } = exchangeSummary(fit.item.exchange);
  return {
    request: { target: keyOf(found), op: 'add', item: fit.item },
    logs: [
      `${label}: adding an exchange of ${steps} ${steps === 1 ? 'step' : 'steps'}${toolCalls.length ? ` and ${toolCalls.length} tool ${toolCalls.length === 1 ? 'call' : 'calls'}` : ''}: ${shown(fit.item.text, 80)}`,
    ],
  };
}

/**
 * Decides what a State Write does with its input, from the key's definition and the value it had when the
 * turn started. Pure. Throws plain errors that name the key and what was received.
 */
export function planWrite(found: LocatedKey, op: StateNodeOp, inputs: Inputs): WritePlan {
  checkOp(found.def, op);
  if (found.def.type === 'collection') return planCollection({ ...found, def: found.def }, op, inputs);
  if (found.def.type === 'thread') return planThread(found, op, inputs);
  if (found.def.type === 'number') return planNumber({ ...found, def: found.def }, op, inputs);
  return op === 'delete' ? planDelete(found, inputs) : planScalar({ ...found, def: found.def }, inputs);
}
