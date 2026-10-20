import {
  emptyStateSnapshot,
  foldStoryState,
  oldestFirst,
  stateSnapshot,
  withRunSettled,
  withTurnEntry,
  type ChatMessage,
  type StateDefinition,
  type StateKeyView,
  type StateSnapshot,
  type Workflow,
} from '@st/shared';
import { executeWorkflow } from './executor.js';
import { createStateAccess } from './state-access.js';
import type { ExecutionContext, NodeResources } from './types.js';

// Fixtures for tests that build an `ExecutionContext` by hand or need a story state to run against.

/**
 * The members of a hand-built context that depend on the turn: a run that tracks no story state (reads find nothing,
 * writes vanish) and has no replies from workflows above it.
 */
export const stateless = (
  nodeId: string,
): Pick<ExecutionContext, 'state' | 'pendingState' | 'writeState' | 'replies'> => {
  const state = createStateAccess(undefined, nodeId);
  return { state, pendingState: () => state, writeState: () => ({}), replies: [] };
};

type Override = Partial<Omit<StateKeyView, 'meta'>> & { meta?: Partial<StateKeyView['meta']> };

/**
 * A snapshot built by hand: every key of `definitions` at its default, then `keys` (by
 * `<definition name>.<key>`) and `nodes` (by node id, then key) override a value, its meta or its item turns.
 * `turn` is the turn being run; unwritten keys report it as `turnsSinceWrite`.
 */
export function snapshotOf(
  definitions: StateDefinition[],
  options: {
    turn?: number;
    keys?: Record<string, Override>;
    nodes?: Record<string, Record<string, Override>>;
  } = {},
): StateSnapshot {
  const snapshot = emptyStateSnapshot(definitions);
  const turn = options.turn ?? 1;
  snapshot.turn = turn;
  const merge = (base: StateKeyView | undefined, override: Override): StateKeyView =>
    ({
      ...base,
      ...override,
      meta: { written: false, turnsSinceWrite: turn, writtenAtTurn: null, ...base?.meta, ...override.meta },
    }) as StateKeyView;
  for (const definition of definitions) {
    const views = snapshot.keys[definition.id]!;
    for (const key of Object.keys(views)) {
      const view = views[key]!;
      if (!view.meta.written) view.meta.turnsSinceWrite = turn;
      const override = options.keys?.[`${definition.name}.${key}`];
      if (override) views[key] = merge(view, override);
    }
  }
  for (const [nodeId, keys] of Object.entries(options.nodes ?? {}))
    snapshot.nodes[nodeId] = Object.fromEntries(
      Object.entries(keys).map(([key, override]) => [key, merge(undefined, { meta: { written: true }, ...override })]),
    );
  return snapshot;
}

/**
 * A chat played in memory the way the server stores one: each turn folds the story state, runs the workflow
 * against it, then appends the turn's entry and reply. Lets node tests cross several turns.
 */
export type Chat = {
  definitions: StateDefinition[];
  resources: NodeResources;
  messages: ChatMessage[];
  state: unknown;
};

export const newChat = (definitions: StateDefinition[], resources: Partial<NodeResources> = {}): Chat => ({
  definitions,
  resources: {
    presets: { get: async () => undefined },
    stateDefinitions: { get: async (id) => definitions.find((definition) => definition.id === id) },
    ...resources,
  },
  messages: [],
  state: { turns: [] },
});

/**
 * Runs one turn; its replies become assistant messages (as `settleTurn` stores them) and its entry is appended.
 * `history` is what the run's nodes see (and what links in the snapshot are judged against); it defaults to none.
 */
export async function playTurn(
  chat: Chat,
  workflow: Workflow,
  executionId: string,
  message = 'go',
  history: ChatMessage[] = [],
) {
  const story = foldStoryState({
    definitions: oldestFirst(chat.definitions),
    messages: chat.messages,
    state: chat.state,
    workflowId: workflow.id,
  });
  const result = await executeWorkflow(workflow, {
    message,
    sessionId: 'session',
    history,
    secrets: { get: async () => undefined },
    resources: chat.resources,
    executionId,
    state: stateSnapshot(story, chat.definitions, history),
  });
  chat.messages.push(
    ...result.replies.map((reply, index) => ({
      id: `${executionId}-${index}`,
      role: 'assistant' as const,
      content: reply.content,
      createdAt: '',
      executionId,
    })),
  );
  chat.state = withTurnEntry(chat.state, {
    executionId,
    at: '',
    completed: true,
    replies: result.replies.length,
    writes: result.writes,
  });
  return { ...result, turn: story.turn };
}

/**
 * Runs another workflow of the turn `playTurn` just played, the way the server runs the workflows below the one that
 * replied: the state is folded from the chat as it stands with that turn counted (its writes included), the replies
 * of the turn are Chat Input's `replies`, and the run's writes join the turn's entry after everything earlier. A
 * failing run throws before the entry changes.
 */
export async function playLater(
  chat: Chat,
  workflow: Workflow,
  turn: Awaited<ReturnType<typeof playTurn>>,
  message = 'go',
  history: ChatMessage[] = [],
) {
  const story = foldStoryState({
    definitions: oldestFirst(chat.definitions),
    messages: chat.messages,
    state: chat.state,
    workflowId: workflow.id,
    including: turn.execution.id,
  });
  const replies = chat.messages.filter(
    (reply) => reply.role === 'assistant' && reply.executionId === turn.execution.id,
  );
  const result = await executeWorkflow(workflow, {
    message,
    sessionId: 'session',
    history,
    secrets: { get: async () => undefined },
    resources: chat.resources,
    executionId: `${turn.execution.id}-later`,
    state: stateSnapshot(story, chat.definitions, history),
    replies,
  });
  chat.state = withRunSettled(chat.state, turn.execution.id, {
    run: { executionId: result.execution.id, workflowId: workflow.id, part: 'post', status: 'completed' },
    writes: result.writes,
  });
  return result;
}

/** "Delete the reply": removes the assistant messages of a turn. */
export const deleteReplies = (chat: Chat, executionId: string) => {
  chat.messages = chat.messages.filter((message) => message.executionId !== executionId);
};

export const SCENE_ID = '11111111-1111-4111-8111-111111111111';

/** A definition with a key of every type, for the State Read and State Write tests. */
export const sceneDefinition: StateDefinition = {
  id: SCENE_ID,
  name: 'scene',
  keys: {
    tension: { type: 'number', default: 3, min: 0, max: 10 },
    gold: { type: 'number' },
    mood: { type: 'enum', options: ['calm', 'uneasy', 'tense'] },
    alarm: { type: 'boolean' },
    note: { type: 'text', default: 'none' },
    data: { type: 'object' },
    injected: { type: 'collection', cap: 30, fields: { level: 'number', seen: 'boolean', tag: 'text' } },
    plain: { type: 'collection' },
  },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

export const stateResources = (...definitions: StateDefinition[]): NodeResources => ({
  presets: { get: async () => undefined },
  stateDefinitions: { get: async (id) => definitions.find((definition) => definition.id === id) },
});
