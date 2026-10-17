import {
  foldStoryState,
  isPlainObject,
  oldestFirst,
  type ChatMessage,
  type FoldedKey,
  type SessionStateView,
  type StateDefinition,
  type StateWrite,
  type StoryState,
  type TurnEntry,
} from '@st/shared';
import { formatValue, quote } from './format.js';

// What deleting a reply would undo, for the confirmation. The answer comes from the SHARED fold, run twice over the
// chat's messages (with and without the reply) and the turn entries rebuilt from the state view; nothing here
// interprets writes itself. Limit: the view cuts very long write values (`truncated`), so an object key never
// shows its value ("restored to its earlier value") and a long text shows the cut text; a check made before the
// view has caught up with the chat (its turn is missing from it) finds nothing, and the delete then takes the
// ordinary inline confirmation. The server's fold is the truth either way.

const TEXT_MAX = 40;
const ITEM_MAX = 30;
const ITEMS_LISTED = 3;

type Target = { kind: 'definition'; definitionId: string; key: string } | { kind: 'node'; nodeId: string; key: string };
type Item = { id: string; text: string };

const sameTarget = (a: Target, b: Target) =>
  a.key === b.key &&
  (a.kind === 'definition'
    ? b.kind === 'definition' && a.definitionId === b.definitionId
    : b.kind === 'node' && a.nodeId === b.nodeId);

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const entryOf = (turn: SessionStateView['turns'][number]): TurnEntry => ({
  executionId: turn.executionId,
  at: turn.at,
  completed: turn.completed,
  replies: turn.replies,
  writes: turn.writes.map(({ write }) => write),
});

function distinctTargets(writes: readonly StateWrite[]): Target[] {
  const targets: Target[] = [];
  for (const { target } of writes) {
    const next: Target =
      target.kind === 'definition'
        ? { kind: 'definition', definitionId: target.definitionId, key: target.key }
        : { kind: 'node', nodeId: target.nodeId, key: target.key };
    if (!targets.some((known) => sameTarget(known, next))) targets.push(next);
  }
  return targets;
}

const itemsOf = (value: unknown): Item[] =>
  Array.isArray(value)
    ? value.flatMap((raw): Item[] =>
        isPlainObject(raw) && typeof raw.id === 'string'
          ? [{ id: raw.id, text: typeof raw.text === 'string' ? raw.text : formatValue(raw.text) }]
          : [],
      )
    : [];

/** What an item list change reads as: the items it forgets and the ones it brings back, at most three in all. */
function itemChange(before: unknown, after: unknown): string {
  const ids = (items: Item[]) => new Set(items.map((item) => item.id));
  const was = itemsOf(before);
  const now = itemsOf(after);
  const gone = was.filter((item) => !ids(now).has(item.id));
  const back = now.filter((item) => !ids(was).has(item.id));
  const forgotten = gone.slice(0, ITEMS_LISTED);
  const restored = back.slice(0, ITEMS_LISTED - forgotten.length);
  const more = gone.length - forgotten.length + (back.length - restored.length);
  const list = (items: Item[]) => items.map((item) => quote(item.text, ITEM_MAX)).join(', ');
  return [
    forgotten.length && `forgets ${list(forgotten)}`,
    restored.length && `brings back ${list(restored)}`,
    more && `and ${more} more`,
  ]
    .filter(Boolean)
    .join('; ');
}

/** What a scalar key goes back to, in words ("back to 4", "back to the default, 3"). */
function scalarChange(def: StateDefinition['keys'][string], after: FoldedKey): string {
  const lead = after.meta.written ? 'back to' : 'back to the default,';
  const value = after.value;
  switch (def.type) {
    case 'object':
      return after.meta.written ? 'restored to its earlier value' : 'back to its default';
    case 'text':
      return value === '' ? 'back to empty text' : `${lead} ${quote(String(value), TEXT_MAX)}`;
    case 'enum':
      return `${lead} ${quote(String(value), TEXT_MAX)}`;
    default:
      return `${lead} ${formatValue(value)}`;
  }
}

function definitionLine(
  target: Extract<Target, { kind: 'definition' }>,
  before: StoryState,
  after: StoryState,
  definitions: readonly StateDefinition[],
): string | undefined {
  const def = definitions.find((item) => item.id === target.definitionId)?.keys[target.key];
  const was = before.definitions.find((item) => item.definitionId === target.definitionId);
  const now = after.definitions.find((item) => item.definitionId === target.definitionId);
  const wasKey = was?.keys[target.key];
  const nowKey = now?.keys[target.key];
  // A deleted definition or key has nothing to restore; a write for another key type is ignored by the fold.
  if (!def || !was || !wasKey || !nowKey || sameValue(wasKey.value, nowKey.value)) return undefined;
  const name = `${was.name}.${target.key}`;
  return def.type === 'collection'
    ? `${name} (${itemChange(wasKey.value, nowKey.value)})`
    : `${name} (${scalarChange(def, nowKey)})`;
}

function nodeLine(
  target: Extract<Target, { kind: 'node' }>,
  before: StoryState,
  after: StoryState,
  label: string | undefined,
): string | undefined {
  const wasKey = before.nodes.find((node) => node.nodeId === target.nodeId)?.keys[target.key];
  const nowKey = after.nodes.find((node) => node.nodeId === target.nodeId)?.keys[target.key];
  const who = label ?? "A node's memory";
  if (!wasKey || sameValue(wasKey.value, nowKey?.value ?? [])) return undefined;
  if (Array.isArray(wasKey.value)) return `${who} ${itemChange(wasKey.value, nowKey?.value ?? [])}`;
  return nowKey ? `${who}: ${target.key} (back to ${formatValue(nowKey.value)})` : `${who}: ${target.key} cleared`;
}

/**
 * The lines to show before deleting a reply, or undefined when the delete needs no special confirmation: the
 * message is not an assistant reply of a turn that stored something, other replies of the turn survive (the turn
 * still counts), or nothing would change (later turns overwrite everything it wrote).
 */
export function undoneByDelete({
  messageId,
  messages,
  view,
  definitions,
}: {
  messageId: string;
  messages: readonly ChatMessage[];
  view: SessionStateView;
  definitions: readonly StateDefinition[];
}): string[] | undefined {
  const message = messages.find((item) => item.id === messageId);
  const executionId = message?.executionId;
  if (message?.role !== 'assistant' || message.status === 'streaming' || !executionId) return undefined;
  const turn = view.turns.find((item) => item.executionId === executionId);
  if (!turn || turn.turnNumber === null || !turn.writes.length) return undefined;
  const survivors = messages.filter(
    (item) => item.role === 'assistant' && item.status !== 'streaming' && item.executionId === executionId,
  );
  if (survivors.length !== 1) return undefined;

  const ordered = oldestFirst(definitions);
  const state = { turns: view.turns.map(entryOf) };
  const before = foldStoryState({ definitions: ordered, messages, state });
  const after = foldStoryState({ definitions: ordered, messages: messages.filter((item) => item !== message), state });
  const labels = new Map<string, string>();
  for (const node of view.nodes) if (node.label) labels.set(node.nodeId, node.label);
  for (const { write, nodeLabel } of turn.writes)
    if (write.target.kind === 'node' && nodeLabel && !labels.has(write.target.nodeId))
      labels.set(write.target.nodeId, nodeLabel);

  const lines = distinctTargets(turn.writes.map(({ write }) => write)).flatMap((target) => {
    const line =
      target.kind === 'definition'
        ? definitionLine(target, before, after, definitions)
        : nodeLine(target, before, after, labels.get(target.nodeId));
    return line ? [line] : [];
  });
  return lines.length ? lines : undefined;
}

/** The text of the `window.confirm` for a delete that undoes stored state. */
export function deleteConfirmText(lines: readonly string[]): string {
  return `Deleting this reply also undoes what its turn stored:\n\n${lines.map((line) => `- ${line}`).join('\n')}\n\nDelete the reply?`;
}
