import {
  DRAW_STATE_KEY,
  analyzeLinks,
  effectivePostRun,
  fingerprintMessages,
  foldStoryState,
  oldestFirst,
  previewWrite,
  type ChatMessage,
  type FoldedKey,
  type ItemLink,
  type ItemLinkView,
  type SessionStateView,
  type StateDefinition,
  type StateWrite,
  type TurnEntry,
} from '@st/shared';
import { definition } from '../../stateDefinitions/test-fixtures.js';

// Test fixtures for the story state helpers. `buildView` assembles the answer of `GET /api/sessions/:id/state` the
// way the server does (the shared fold over the stored turns, the writes shortened by the shared `previewWrite`),
// so the chips and the delete check are tested against a view that is consistent with its messages.

export const scene: StateDefinition = definition();
const SCENE = scene.id;

const target = (key: string) => ({ kind: 'definition' as const, definitionId: SCENE, key });

export const setWrite = (key: string, value: unknown, nodeId = 'bump'): StateWrite => ({
  op: 'set',
  target: target(key),
  nodeId,
  value,
});
export const addWrite = (key: string, id: string, text: string, extra: Record<string, unknown> = {}): StateWrite => ({
  op: 'add',
  target: target(key),
  nodeId: 'note',
  item: { id, text, ...extra },
});
/** An add that links the item to chat messages (State Write's `messages` input, fingerprint filled in at commit). */
export const linkedWrite = (key: string, id: string, text: string, link: ItemLink): StateWrite =>
  addWrite(key, id, text, { messages: link });
/** A link to the messages with these ids, with the fingerprint they have in `messages`. */
export const linkTo = (messages: readonly ChatMessage[], ids: string[]): ItemLink => ({
  ids,
  fingerprint: fingerprintMessages(ids.map((id) => messages.find((message) => message.id === id) as ChatMessage)),
});
export const removeWrite = (key: string, itemId: string): StateWrite => ({
  op: 'remove',
  target: target(key),
  nodeId: 'note',
  itemId,
});
export const drawWrite = (id: string, text: string): StateWrite => ({
  op: 'add',
  target: { kind: 'node', nodeId: 'draw', key: DRAW_STATE_KEY },
  nodeId: 'draw',
  item: { id, text, entryKey: `smells:${text}` },
});

export const entry = (executionId: string, writes: StateWrite[] = [], replies = 1, completed = true): TurnEntry => ({
  executionId,
  at: '2026-01-01T00:00:00.000Z',
  completed,
  replies,
  writes,
});

export const reply = (executionId: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m-${executionId}${extra.nodeId ? `-${extra.nodeId}` : ''}`,
  role: 'assistant',
  content: `reply of ${executionId}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  executionId,
  ...extra,
});
export const userMessage = (id = 'u1'): ChatMessage => ({
  id,
  role: 'user',
  content: 'go',
  createdAt: '2026-01-01T00:00:00.000Z',
});

/** The items of a list as the server's view shows them: those that link to messages get the computed `link`. */
function withViewLinks(value: unknown, history: readonly ChatMessage[]): unknown {
  if (!Array.isArray(value)) return value;
  const byItem = new Map(analyzeLinks(value, history).map((found) => [found.item, found]));
  return value.map((item) => {
    const found = byItem.get(item);
    if (!found) return item;
    const link: ItemLinkView = {
      status: found.status,
      replaced: found.replaced,
      count: found.link.ids.length,
      missing: found.link.ids.length - found.survivors.length,
      ...(found.first !== undefined && {
        firstIndex: found.first,
        lastIndex: found.last,
        firstMessageId: found.firstId,
        lastMessageId: found.lastId,
      }),
      messageIds: found.survivors,
    };
    return { ...item, link };
  });
}

const keyViews = (keys: Record<string, FoldedKey>, history: readonly ChatMessage[] = []) => {
  const entries = Object.entries(keys);
  return {
    values: Object.fromEntries(entries.map(([key, folded]) => [key, withViewLinks(folded.value, history)])),
    meta: Object.fromEntries(entries.map(([key, folded]) => [key, folded.meta])),
    history: Object.fromEntries(entries.map(([key, folded]) => [key, folded.history])),
  };
};

export function buildView({
  definitions = [scene],
  messages,
  entries,
  nodeLabels = { bump: 'State Write #1 (state-write)', note: 'State Write #2 (state-write)', draw: 'Draw #1 (draw)' },
}: {
  definitions?: readonly StateDefinition[];
  messages: readonly ChatMessage[];
  entries: readonly TurnEntry[];
  /** Node id -> name; a node missing here reads as deleted. */
  nodeLabels?: Record<string, string>;
}): SessionStateView {
  const ordered = oldestFirst(definitions);
  const story = foldStoryState({ definitions: ordered, messages, state: { turns: entries } });
  const names = new Map(ordered.map((item) => [item.id, item.name]));
  const history = messages.filter((message) => !message.status || message.status === 'final');
  return {
    turn: story.turn,
    definitions: story.definitions.map((folded) => ({
      definitionId: folded.definitionId,
      name: folded.name,
      ...keyViews(folded.keys, history),
      warnings: folded.warnings,
    })),
    nodes: story.nodes.map((folded) => {
      const label = nodeLabels[folded.nodeId];
      return { nodeId: folded.nodeId, ...(label !== undefined && { label }), ...keyViews(folded.keys), omitted: {} };
    }),
    turns: story.turns.map(({ entry: stored, turn }) => {
      // As the server reports it: the run is live (no restart happened), so a stored `running` stays running.
      const post = effectivePostRun(stored, true);
      return {
        executionId: stored.executionId,
        at: stored.at,
        completed: stored.completed,
        replies: stored.replies,
        turnNumber: turn,
        ...(post && { postStatus: post.status }),
        ...(post?.executionId !== undefined && { postExecutionId: post.executionId }),
        ...(post?.error !== undefined && { postError: post.error }),
        ...(stored.linkWarnings?.length && { linkWarnings: stored.linkWarnings }),
        writes: stored.writes.map((write) => {
          const definitionName = write.target.kind === 'definition' ? names.get(write.target.definitionId) : undefined;
          const nodeLabel = nodeLabels[write.nodeId];
          const preview = previewWrite(write);
          return {
            write: preview.write,
            ...(preview.truncated && { truncated: true }),
            ...(definitionName !== undefined && { definitionName }),
            ...(nodeLabel !== undefined && { nodeLabel }),
          };
        }),
      };
    }),
  };
}
