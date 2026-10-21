import { WRITE_PREVIEW_LIMIT } from '../api/state.js';
import { isPlainObject } from './helpers.js';
import type { StateWrite } from './writes.js';

type Item = Record<string, unknown>;
const hasExchange = (item: Item): item is Item & { exchange: unknown[] } => Array.isArray(item.exchange);

/**
 * How many steps an exchange took (its assistant messages) and the names of the tool calls the model made, in order.
 * Reads stored data defensively: anything that is not a message or a call is skipped.
 */
export function exchangeSummary(exchange: readonly unknown[]): { steps: number; toolCalls: string[] } {
  const messages = exchange.filter(isPlainObject);
  const calls = messages.flatMap((message) => (Array.isArray(message.tool_calls) ? message.tool_calls : []));
  return {
    steps: messages.filter((message) => message.role === 'assistant').length,
    toolCalls: calls.flatMap((call) =>
      isPlainObject(call) && isPlainObject(call.function) ? [String(call.function.name)] : [],
    ),
  };
}

/**
 * A thread item as the state view shows it: `{ id, text, steps, toolCalls, turnId, runId }`, the item without its
 * `exchange` and `input` plus the `exchangeSummary`. The whole exchange stays in the stored turn and in the execution
 * log of `runId`; the view never carries it. An item without an `exchange` list (any other) is returned as it is.
 */
export function viewThreadItem<T extends Item>(item: T): T | Item {
  if (!hasExchange(item)) return item;
  const { exchange, input: _input, ...rest } = item;
  return { ...rest, ...exchangeSummary(exchange) };
}

/**
 * A stored write as the state view shows it. Long text is cut to `WRITE_PREVIEW_LIMIT` characters and a large
 * object becomes its JSON text, cut the same way, so the view of a long chat stays small whatever its keys hold.
 * Item ids are never cut, and neither is an item that links to messages. The stored write is not changed.
 */
export function previewWrite(write: StateWrite): { write: StateWrite; truncated: boolean } {
  let truncated = false;
  const shorten = (value: unknown): unknown => {
    const text = typeof value === 'string' ? value : typeof value === 'object' && value ? JSON.stringify(value) : '';
    if (text.length <= WRITE_PREVIEW_LIMIT) return value;
    truncated = true;
    return text.slice(0, WRITE_PREVIEW_LIMIT);
  };
  if (write.op === 'set') {
    const value = shorten(write.value);
    return { write: truncated ? { ...write, value } : write, truncated };
  }
  if (write.op === 'update') {
    const text = write.text === undefined ? {} : { text: shorten(write.text) as string };
    const fields = write.fields && {
      fields: Object.fromEntries(Object.entries(write.fields).map(([name, value]) => [name, shorten(value)])),
    };
    return { write: truncated ? { ...write, ...text, ...fields } : write, truncated };
  }
  // A thread item shows its summary, with the text cut like any text: the exchange never leaves the stored turn.
  if (write.op === 'add' && hasExchange(write.item)) {
    const view = viewThreadItem(write.item);
    const item = { ...view, id: write.item.id, text: shorten(view.text) as string };
    return { write: { ...write, item }, truncated };
  }
  // A linked item is kept whole (summaries are few, and a cut text or link would be wrong to show).
  if (write.op === 'add' && !write.item.messages) {
    const item = Object.fromEntries(
      Object.entries(write.item).map(([name, value]) => [name, name === 'id' ? value : shorten(value)]),
    ) as typeof write.item;
    return { write: truncated ? { ...write, item } : write, truncated };
  }
  return { write, truncated };
}
