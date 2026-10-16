import type { StateDefinition } from './definition.js';
import { foldDefinitionKey, foldNodeKey, removedKeyProblem, type SlotWrite } from './fold-slots.js';
import { byText } from './helpers.js';
import type { FoldedDefinition, FoldedKey, FoldedNode, StateWarning, StoryState } from './fold-types.js';
import { turnPresence, type PresenceMessage, type TurnPresence } from './turns.js';
import { readTurnEntries } from './writes.js';

type Slots = Map<string, SlotWrite[]>;

// The writes of present turns grouped by definition id and by node id, then by key, in stored order.
function collectWrites(turns: readonly TurnPresence[]) {
  const byDefinition = new Map<string, Slots>();
  const byNode = new Map<string, Slots>();
  for (const { entry, turn } of turns) {
    if (turn === null) continue;
    for (const write of entry.writes) {
      const { target } = write;
      const owners = target.kind === 'definition' ? byDefinition : byNode;
      const owner = target.kind === 'definition' ? target.definitionId : target.nodeId;
      const slots = owners.get(owner) ?? new Map<string, SlotWrite[]>();
      owners.set(owner, slots);
      const writes = slots.get(target.key) ?? [];
      slots.set(target.key, writes);
      writes.push({ turn, write });
    }
  }
  return { byDefinition, byNode };
}

function foldDefinition(definition: StateDefinition, slots: Slots | undefined, turn: number): FoldedDefinition {
  const keys: Record<string, FoldedKey> = {};
  const warnings: StateWarning[] = [];
  const warn = (key: string, message: string) => warnings.push({ definition: definition.name, key, message });
  for (const [key, def] of Object.entries(definition.keys)) {
    const folded = foldDefinitionKey(def, slots?.get(key) ?? [], turn);
    keys[key] = folded.key;
    for (const problem of folded.problems) warn(key, problem);
  }
  const removed = [...(slots ?? [])].filter(([key]) => !Object.hasOwn(definition.keys, key));
  for (const [key, writes] of removed.sort(([a], [b]) => byText(a, b))) warn(key, removedKeyProblem(writes.length));
  return { definitionId: definition.id, name: definition.name, keys, warnings };
}

function foldNode(nodeId: string, slots: Slots, turn: number): FoldedNode {
  const keys: Record<string, FoldedKey> = {};
  for (const [key, writes] of [...slots].sort(([a], [b]) => byText(a, b))) keys[key] = foldNodeKey(writes, turn);
  return { nodeId, keys };
}

export type FoldInput = {
  /** The current definitions, in the order the result lists them. */
  definitions: readonly StateDefinition[];
  messages: readonly PresenceMessage[];
  /** The stored `session.state`; any shape (older sessions have none). */
  state: unknown;
};

/**
 * The story state of a chat: what its present turns stored, read against the current definitions. Pure,
 * never throws and never changes its input; stored data is only ever read.
 *
 * - A value is what the most recent present turn that wrote the key left in it (`delete` leaves the
 *   default); a key no present turn wrote reads as its default.
 * - A collection holds the items added by present turns minus those removed by present turns, newest
 *   first, cut to its `cap`.
 * - A stored value that doesn't fit the current definition reads as the default, with a warning. Writes for
 *   a key the definition no longer has, or for another key type, are ignored (and reported); writes for a
 *   definition that no longer exists are ignored silently. Restoring the definition brings them back.
 */
export function foldStoryState({ definitions, messages, state }: FoldInput): StoryState {
  const turns = turnPresence(messages, readTurnEntries(state));
  const turn = turns.filter((presence) => presence.turn !== null).length + 1;
  const { byDefinition, byNode } = collectWrites(turns);
  return {
    turn,
    turns,
    definitions: definitions.map((definition) => foldDefinition(definition, byDefinition.get(definition.id), turn)),
    nodes: [...byNode].sort(([a], [b]) => byText(a, b)).map(([nodeId, slots]) => foldNode(nodeId, slots, turn)),
  };
}
