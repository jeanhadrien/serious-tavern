import type { StateDefinition } from './definition.js';
import { foldDefinitionKey, foldNodeKey, removedKeyProblem, type SlotWrite } from './fold-slots.js';
import { byText } from './helpers.js';
import type { FoldedDefinition, FoldedKey, FoldedNode, StateWarning, StoryState } from './fold-types.js';
import { turnPresence, type PresenceMessage, type TurnPresence } from './turns.js';
import { readTurnEntries } from './writes.js';

type Slots = Map<string, SlotWrite[]>;

// The writes of present turns grouped by definition id and by node id, then by key, in stored order.
function collectWrites(turns: readonly TurnPresence[], workflowId: string | undefined) {
  const byDefinition = new Map<string, Slots>();
  const byNode = new Map<string, { nodeId: string; workflowId?: string; slots: Slots }>();
  for (const { entry, turn } of turns) {
    if (turn === null) continue;
    for (const write of entry.writes) {
      const { target } = write;
      let slots: Slots;
      if (target.kind === 'definition') {
        slots = byDefinition.get(target.definitionId) ?? new Map<string, SlotWrite[]>();
        byDefinition.set(target.definitionId, slots);
      } else {
        // A node's own state is its workflow's. A scoped fold reads the workflow's writes and the ones without a
        // workflow id (legacy, from before chats ran several workflows), merged per node id.
        if (workflowId !== undefined && target.workflowId !== undefined && target.workflowId !== workflowId) continue;
        const owner = workflowId === undefined ? target.workflowId : undefined;
        const id = `${target.nodeId}\u0000${owner ?? ''}`;
        const node = byNode.get(id) ?? {
          nodeId: target.nodeId,
          ...(owner === undefined ? {} : { workflowId: owner }),
          slots: new Map<string, SlotWrite[]>(),
        };
        byNode.set(id, node);
        slots = node.slots;
      }
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

function foldNode(
  { nodeId, workflowId, slots }: { nodeId: string; workflowId?: string; slots: Slots },
  turn: number,
): FoldedNode {
  const keys: Record<string, FoldedKey> = {};
  for (const [key, writes] of [...slots].sort(([a], [b]) => byText(a, b))) keys[key] = foldNodeKey(writes, turn);
  return { nodeId, ...(workflowId === undefined ? {} : { workflowId }), keys };
}

export type FoldInput = {
  /** The current definitions, in the order the result lists them. */
  definitions: readonly StateDefinition[];
  messages: readonly PresenceMessage[];
  /** The stored `session.state`; any shape (older sessions have none). */
  state: unknown;
  /**
   * Read the state as of this turn instead of the next one (present turns + 1): a post-turn run reads at the turn
   * it follows, so `turnsSinceWrite` of a key that turn wrote is 0.
   */
  turn?: number;
  /**
   * Scopes the nodes' own state to this workflow (what a run of it reads): node writes of other workflows are left out
   * and the ones without a workflow id are merged into its own. Without it every workflow's nodes are listed apart (the
   * state view's). Definition keys are shared by all workflows either way.
   */
  workflowId?: string;
  /**
   * The turn being run, once its first run has settled (`turnPresence`'s `including`): it counts as present, and unless
   * `turn` says otherwise the state is read as of that turn, so `trigger.turn` is the same for every run of the turn.
   */
  including?: string;
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
export function foldStoryState({
  definitions,
  messages,
  state,
  turn: readAt,
  workflowId,
  including,
}: FoldInput): StoryState {
  const turns = turnPresence(messages, readTurnEntries(state), including);
  const own = including === undefined ? undefined : turns.find(({ entry }) => entry.executionId === including)?.turn;
  const turn = readAt ?? own ?? turns.filter((presence) => presence.turn !== null).length + 1;
  const { byDefinition, byNode } = collectWrites(turns, workflowId);
  return {
    turn,
    turns,
    definitions: definitions.map((definition) => foldDefinition(definition, byDefinition.get(definition.id), turn)),
    nodes: [...byNode].sort(([a], [b]) => byText(a, b)).map(([, node]) => foldNode(node, turn)),
  };
}
