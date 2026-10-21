import type { StateDefinition, StateKeyDef } from './definition.js';
import { foldStoryState } from './fold.js';
import type { PresenceMessage } from './turns.js';
import type { CollectionItem, StateWrite, TurnEntry } from './writes.js';

// Builders for the state tests: writes, turn entries, messages and definitions.

export const DEF = '11111111-1111-4111-8111-111111111111';

const target = (key: string, definitionId = DEF) => ({ kind: 'definition' as const, definitionId, key });
const nodeTarget = (nodeId: string, key: string) => ({ kind: 'node' as const, nodeId, key });

export const setWrite = (key: string, value: unknown, definitionId = DEF): StateWrite => ({
  op: 'set',
  target: target(key, definitionId),
  nodeId: 'writer',
  value,
});
export const addWrite = (key: string, item: CollectionItem, definitionId = DEF): StateWrite => ({
  op: 'add',
  target: target(key, definitionId),
  nodeId: 'writer',
  item,
});
export const removeWrite = (key: string, itemId: string, definitionId = DEF): StateWrite => ({
  op: 'remove',
  target: target(key, definitionId),
  nodeId: 'writer',
  itemId,
});
export const updateWrite = (key: string, itemId: string, text: string, definitionId = DEF): StateWrite => ({
  op: 'update',
  target: target(key, definitionId),
  nodeId: 'writer',
  itemId,
  text,
});
export const deleteWrite = (key: string, definitionId = DEF): StateWrite => ({
  op: 'delete',
  target: target(key, definitionId),
  nodeId: 'writer',
});
export const nodeAddWrite = (nodeId: string, key: string, item: CollectionItem): StateWrite => ({
  op: 'add',
  target: nodeTarget(nodeId, key),
  nodeId,
  item,
});
export const nodeSetWrite = (nodeId: string, key: string, value: unknown): StateWrite => ({
  op: 'set',
  target: nodeTarget(nodeId, key),
  nodeId,
  value,
});
export const nodeDeleteWrite = (nodeId: string, key: string): StateWrite => ({
  op: 'delete',
  target: nodeTarget(nodeId, key),
  nodeId,
});

/** A settled turn that completed with one reply, unless `over` says otherwise. */
export const turnEntry = (
  executionId: string,
  writes: StateWrite[] = [],
  over: Partial<TurnEntry> = {},
): TurnEntry => ({
  executionId,
  at: '2026-01-01T00:00:00.000Z',
  completed: true,
  replies: 1,
  writes,
  ...over,
});

export const reply = (
  executionId: string,
  status?: PresenceMessage['status'],
  inactive?: boolean,
): PresenceMessage => ({
  role: 'assistant',
  executionId,
  ...(status && { status }),
  ...(inactive && { inactive }),
});
export const userMessage = (executionId: string): PresenceMessage => ({ role: 'user', executionId });

export const definition = (
  name: string,
  keys: Record<string, StateKeyDef>,
  over: Partial<StateDefinition> = {},
): StateDefinition => ({
  id: DEF,
  name,
  keys,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

export const item = (id: string, text = id, extra: Record<string, unknown> = {}): CollectionItem => ({
  id,
  text,
  ...extra,
});

export const OTHER_DEF = '22222222-2222-4222-8222-222222222222';

/** A definition with one key of every type, used by the fold tests. */
export const scene = definition('scene', {
  tension: { type: 'number', default: 3, min: 0, max: 10 },
  armed: { type: 'boolean' },
  mood: { type: 'enum', options: ['calm', 'uneasy', 'tense'], default: 'calm' },
  note: { type: 'text', default: 'none' },
  extra: { type: 'object', default: { a: 1 } },
  log: { type: 'collection', cap: 3, fields: { level: 'number' } },
});

/** Folds `turns` into a story; a turn listed in `gone` has lost its reply. */
export function foldTurns(
  turns: TurnEntry[],
  options: { defs?: StateDefinition[]; gone?: string[]; extraMessages?: PresenceMessage[] } = {},
) {
  const gone = new Set(options.gone);
  const messages = turns.filter((t) => !gone.has(t.executionId)).map((t) => reply(t.executionId, 'final'));
  return foldStoryState({
    definitions: options.defs ?? [scene],
    messages: [...messages, ...(options.extraMessages ?? [])],
    state: { turns },
  });
}
type Story = ReturnType<typeof foldTurns>;
export const keyOf = (story: Story, name: string, definitionIndex = 0) =>
  story.definitions[definitionIndex]!.keys[name]!;
export const valueAt = (story: Story, name: string) => keyOf(story, name).value;
/** The ids of a collection key's items, newest first. */
export const idsOf = (story: Story, name: string) => (keyOf(story, name).value as { id: string }[]).map((e) => e.id);
