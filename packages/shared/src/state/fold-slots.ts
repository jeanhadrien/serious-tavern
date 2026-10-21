import { describeSettingValue } from '../chat-settings.js';
import { isListKeyType, keyDefault, keyValueProblem, type StateKeyDef } from './definition.js';
import type { FoldedKey, HistoryPoint, KeyMeta } from './fold-types.js';
import type { CollectionItem, StateWrite } from './writes.js';

/** A write of a present turn, with that turn's number. */
export type SlotWrite = { turn: number; write: StateWrite };

// Each key keeps this many history points (the newest); sparklines never need more.
const HISTORY_LIMIT = 100;

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** Never written counts as written before turn 1, so `turnsSinceWrite` equals the turn being run. */
function metaFor(lastTurn: number | undefined, turn: number): KeyMeta {
  return lastTurn === undefined
    ? { written: false, turnsSinceWrite: turn, writtenAtTurn: null }
    : { written: true, turnsSinceWrite: turn - lastTurn, writtenAtTurn: lastTurn };
}

// One point per present turn that wrote the key, holding the value after that turn's last write.
function pushPoint(history: HistoryPoint[], point: HistoryPoint) {
  if (history.at(-1)?.turn === point.turn) history[history.length - 1] = point;
  else history.push(point);
}

// Text and object values can be large and change every turn, so their history keeps only the turns (a sparkline
// has nothing to draw for them anyway). Number, boolean and enum values are small.
const smallValues = (def: StateKeyDef) => def.type !== 'text' && def.type !== 'object';
// A node's implicit scalar has no declared type: keep what is certainly small.
const isSmall = (value: unknown) => value === null || typeof value === 'number' || typeof value === 'boolean';

/** What a write leaves in a scalar key: the value as it reads now, and why a stored value was refused. */
type Effective = { value: unknown; warning?: string };

function foldScalar(
  writes: readonly SlotWrite[],
  fallback: unknown,
  effectiveOf: (write: StateWrite) => Effective,
  keepsValue: (value: unknown) => boolean,
  turn: number,
): { key: FoldedKey; warning?: string } {
  const history: HistoryPoint[] = [];
  let last: Effective | undefined;
  for (const { turn: at, write } of writes) {
    last = effectiveOf(write);
    pushPoint(history, keepsValue(last.value) ? { turn: at, value: structuredClone(last.value) } : { turn: at });
  }
  const lastTurn = writes.at(-1)?.turn;
  return {
    key: {
      value: structuredClone(last ? last.value : fallback),
      meta: metaFor(lastTurn, turn),
      history: history.slice(-HISTORY_LIMIT),
    },
    warning: last?.warning,
  };
}

// The items a collection holds after replaying add, update, remove and delete writes in order: the items added by
// present turns minus the ones removed by present turns, with the text of their last update. An update keeps the
// item's id, fields, link, place and turn. Oldest first.
function replay(writes: readonly SlotWrite[], cap: number | undefined, history: HistoryPoint[]) {
  let items: { item: CollectionItem; turn: number }[] = [];
  for (const { turn, write } of writes) {
    if (write.op === 'add') items.push({ item: write.item, turn });
    else if (write.op === 'update')
      items = items.map((entry) =>
        entry.item.id === write.itemId ? { ...entry, item: { ...entry.item, text: write.text } } : entry,
      );
    else if (write.op === 'remove') items = items.filter(({ item }) => item.id !== write.itemId);
    else if (write.op === 'delete') items = [];
    else continue;
    pushPoint(history, { turn, value: Math.min(items.length, cap ?? Number.POSITIVE_INFINITY) });
  }
  return items;
}

function foldCollection(writes: readonly SlotWrite[], cap: number | undefined, turn: number): FoldedKey {
  const history: HistoryPoint[] = [];
  // Newest first; items added in the same turn come out in reverse write order.
  const newest = replay(writes, cap, history).reverse();
  const kept = cap === undefined ? newest : newest.slice(0, cap);
  return {
    value: kept.map(({ item }) => structuredClone(item)),
    meta: { ...metaFor(writes.at(-1)?.turn, turn), count: kept.length, droppedByCap: newest.length - kept.length },
    history: history.slice(-HISTORY_LIMIT),
    itemTurns: kept.map((entry) => entry.turn),
  };
}

// A thread item's text is always its exchange's (`exchangeText`), so a thread never takes an `update`.
const suits = (def: StateKeyDef, write: StateWrite) =>
  isListKeyType(def.type)
    ? write.op !== 'set' && !(def.type === 'thread' && write.op === 'update')
    : write.op === 'set' || write.op === 'delete';

/**
 * One key of a definition, folded against the CURRENT definition. Writes that don't suit the key's type
 * are ignored; a stored scalar that doesn't fit reads as the default. Stored data is never touched.
 * `problems` are plain-language warnings for the panel.
 */
export function foldDefinitionKey(
  def: StateKeyDef,
  writes: readonly SlotWrite[],
  turn: number,
): { key: FoldedKey; problems: string[] } {
  const accepted = writes.filter(({ write }) => suits(def, write));
  const ignored = writes.length - accepted.length;
  const problems =
    ignored > 0
      ? [
          `${ignored} stored ${plural(ignored, 'write was', 'writes were')} made for another key type and ${plural(ignored, 'is', 'are')} ignored`,
        ]
      : [];
  // A thread folds like a collection (its items are exchanges; the fold does not look inside either kind).
  if (def.type === 'collection' || def.type === 'thread')
    return { key: foldCollection(accepted, def.cap, turn), problems };
  const fallback = keyDefault(def);
  const { key, warning } = foldScalar(
    accepted,
    fallback,
    (write) => {
      if (write.op !== 'set') return { value: fallback };
      const problem = keyValueProblem(def, write.value);
      if (!problem) return { value: write.value };
      return {
        value: fallback,
        warning: `Stored value ${describeSettingValue(write.value)} ${problem}; using default ${describeSettingValue(fallback)}`,
      };
    },
    () => smallValues(def),
    turn,
  );
  return { key, problems: warning ? [...problems, warning] : problems };
}

/** The warning for writes whose key the definition no longer has. */
export function removedKeyProblem(count: number): string {
  return `The definition no longer has this key; ${count} stored ${plural(count, 'write is', 'writes are')} ignored`;
}

/**
 * A node's implicit key: it has no definition, so it is a collection when any `add` or `remove` was
 * written, else a scalar holding the last `set` (`delete` reads as null). No cap, no validation.
 */
export function foldNodeKey(writes: readonly SlotWrite[], turn: number): FoldedKey {
  if (writes.some(({ write }) => write.op === 'add' || write.op === 'remove'))
    return foldCollection(
      writes.filter(({ write }) => write.op !== 'set'),
      undefined,
      turn,
    );
  return foldScalar(writes, null, (write) => ({ value: write.op === 'set' ? write.value : null }), isSmall, turn).key;
}
