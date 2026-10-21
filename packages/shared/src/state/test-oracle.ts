import { keyDefault, keyValueProblem, type StateDefinition, type StateKeyDef } from './definition.js';
import type { PresenceMessage } from './turns.js';
import type { CollectionItem, StateWrite, TurnEntry } from './writes.js';

// A deliberately naive second implementation of the fold, for the randomized test: it filters the present
// turns first, then reads every key from a plain list of the writes that suit it. It shares no code with
// fold.ts apart from the definition helpers (`keyDefault`, `keyValueProblem`).

export type Expected = {
  value: unknown;
  written: boolean;
  turnsSinceWrite: number;
  writtenAtTurn: number | null;
  count?: number;
  droppedByCap?: number;
  itemTurns?: number[];
  history: { turn: number; value?: unknown }[];
  /** How many warnings this key should have. */
  warnings: number;
};

type Item = { item: CollectionItem; turn: number };
type Accepted = { turn: number; write: StateWrite };

function present(entries: readonly TurnEntry[], messages: readonly PresenceMessage[]): TurnEntry[] {
  return entries.filter((entry) =>
    entry.replies > 0
      ? messages.some((m) => m.role === 'assistant' && m.status !== 'streaming' && m.executionId === entry.executionId)
      : entry.completed,
  );
}

function replayItems(writes: Accepted[], upTo = Number.POSITIVE_INFINITY): Item[] {
  let items: Item[] = [];
  for (const { turn, write } of writes) {
    if (turn > upTo) break;
    if (write.op === 'add') items = [...items, { item: write.item, turn }];
    if (write.op === 'update')
      items = items.map((entry) =>
        entry.item.id === write.itemId
          ? {
              ...entry,
              item: {
                ...entry.item,
                ...Object.fromEntries(
                  Object.entries(write.fields ?? {}).filter(([name]) => !['id', 'text', 'messages'].includes(name)),
                ),
                ...(write.text === undefined ? {} : { text: write.text }),
              },
            }
          : entry,
      );
    if (write.op === 'remove') items = items.filter((entry) => entry.item.id !== write.itemId);
    if (write.op === 'delete') items = [];
  }
  return items;
}

const turnsOf = (writes: Accepted[]) => [...new Set(writes.map((w) => w.turn))];

function expectCollection(writes: Accepted[], cap: number | undefined, turn: number): Expected {
  const items = replayItems(writes).reverse();
  const kept = cap === undefined ? items : items.slice(0, cap);
  const last = writes.at(-1)?.turn;
  return {
    value: kept.map((entry) => entry.item),
    written: last !== undefined,
    turnsSinceWrite: last === undefined ? turn : turn - last,
    writtenAtTurn: last ?? null,
    count: kept.length,
    droppedByCap: items.length - kept.length,
    itemTurns: kept.map((entry) => entry.turn),
    history: turnsOf(writes).map((t) => ({ turn: t, value: Math.min(replayItems(writes, t).length, cap ?? Infinity) })),
    warnings: 0,
  };
}

function expectScalar(def: StateKeyDef, writes: Accepted[], turn: number): Expected {
  if (def.type === 'collection' || def.type === 'thread') throw new Error('scalar only');
  const effective = (write: StateWrite) => {
    if (write.op !== 'set') return { value: keyDefault(def), bad: false };
    const bad = keyValueProblem(def, write.value) !== undefined;
    return { value: bad ? keyDefault(def) : write.value, bad };
  };
  const last = writes.at(-1);
  const lastEffective = last && effective(last.write);
  return {
    value: lastEffective ? lastEffective.value : keyDefault(def),
    written: last !== undefined,
    turnsSinceWrite: last ? turn - last.turn : turn,
    writtenAtTurn: last?.turn ?? null,
    history: turnsOf(writes).map((t) =>
      def.type === 'text' || def.type === 'object'
        ? { turn: t }
        : { turn: t, value: effective(writes.filter((w) => w.turn === t).at(-1)!.write).value },
    ),
    warnings: lastEffective?.bad ? 1 : 0,
  };
}

export type Oracle = {
  turn: number;
  keys: Record<string, Record<string, Expected>>;
  /** Expected warning count per definition id (bad values, ignored writes, vanished keys). */
  warnings: Record<string, number>;
  nodes: Record<string, Record<string, Expected>>;
};

export function oracleFold(
  definitions: readonly StateDefinition[],
  allEntries: readonly TurnEntry[],
  messages: readonly PresenceMessage[],
): Oracle {
  const entries = present(allEntries, messages);
  const turn = entries.length + 1;
  const all: Accepted[] = entries.flatMap((entry, index) => entry.writes.map((write) => ({ turn: index + 1, write })));
  const forTarget = (match: (write: StateWrite) => boolean) => all.filter(({ write }) => match(write));

  const keys: Oracle['keys'] = {};
  const warnings: Oracle['warnings'] = {};
  for (const definition of definitions) {
    keys[definition.id] = {};
    warnings[definition.id] = 0;
    for (const [key, def] of Object.entries(definition.keys)) {
      const mine = forTarget(
        (w) => w.target.kind === 'definition' && w.target.definitionId === definition.id && w.target.key === key,
      );
      const isList = def.type === 'collection' || def.type === 'thread';
      const suits = (w: StateWrite) =>
        isList ? w.op !== 'set' && !(def.type === 'thread' && w.op === 'update') : w.op === 'set' || w.op === 'delete';
      const accepted = mine.filter(({ write }) => suits(write));
      const expected =
        def.type === 'collection' || def.type === 'thread'
          ? expectCollection(accepted, def.cap, turn)
          : expectScalar(def, accepted, turn);
      expected.warnings += accepted.length < mine.length ? 1 : 0;
      keys[definition.id]![key] = expected;
      warnings[definition.id]! += expected.warnings;
    }
    // Writes for keys the definition no longer has: one warning per such key.
    const stray = new Set(
      forTarget((w) => w.target.kind === 'definition' && w.target.definitionId === definition.id).map(
        ({ write }) => write.target.key,
      ),
    );
    for (const key of stray) if (!Object.hasOwn(definition.keys, key)) warnings[definition.id]!++;
  }

  const nodes: Oracle['nodes'] = {};
  const nodeTargets = forTarget((w) => w.target.kind === 'node');
  for (const { write } of nodeTargets) {
    if (write.target.kind !== 'node') continue;
    const { nodeId, key } = write.target;
    if (nodes[nodeId]?.[key]) continue;
    const mine = nodeTargets.filter(
      (a) => a.write.target.kind === 'node' && a.write.target.nodeId === nodeId && a.write.target.key === key,
    );
    const isCollection = mine.some(({ write: w }) => w.op === 'add' || w.op === 'remove');
    nodes[nodeId] ??= {};
    if (isCollection) {
      nodes[nodeId][key] = expectCollection(
        mine.filter(({ write: w }) => w.op !== 'set'),
        undefined,
        turn,
      );
      continue;
    }
    const last = mine.at(-1)!;
    nodes[nodeId][key] = {
      value: last.write.op === 'set' ? last.write.value : null,
      written: true,
      turnsSinceWrite: turn - last.turn,
      writtenAtTurn: last.turn,
      history: turnsOf(mine).map((t) => {
        const final = mine.filter((a) => a.turn === t).at(-1)!.write;
        const value = final.op === 'set' ? final.value : null;
        return value === null || typeof value === 'number' || typeof value === 'boolean'
          ? { turn: t, value }
          : { turn: t };
      }),
      warnings: 0,
    };
  }
  return { turn, keys, warnings, nodes };
}
