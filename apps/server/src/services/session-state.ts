import { registry } from '@st/engine';
import {
  NODE_ITEMS_LIMIT,
  nodeDisplayName,
  previewWrite,
  type ApiResponse,
  type FoldedKey,
  type StateWrite,
} from '@st/shared';
import type { AppContext } from '../context.js';
import { requireEntity } from '../errors.js';
import { loadStoryState } from './story-state.js';

type View = ApiResponse<'getSessionState'>;

/** The folded keys as the three parallel records of the API. */
function keyViews(keys: Record<string, FoldedKey>) {
  const entries = Object.entries(keys);
  return {
    values: Object.fromEntries(entries.map(([key, folded]) => [key, folded.value])),
    meta: Object.fromEntries(entries.map(([key, folded]) => [key, folded.meta])),
    history: Object.fromEntries(entries.map(([key, folded]) => [key, folded.history])),
  };
}

/**
 * A node's keys: a collection grows with every write and has no cap, so only its newest `NODE_ITEMS_LIMIT` items
 * are sent, with the number left out (the fold itself keeps them all: Draw's window needs what it needs).
 */
function nodeKeyViews(keys: Record<string, FoldedKey>) {
  const views = keyViews(keys);
  const omitted: Record<string, number> = {};
  for (const [key, folded] of Object.entries(keys)) {
    if (folded.meta.count === undefined || !Array.isArray(folded.value) || folded.value.length <= NODE_ITEMS_LIMIT)
      continue;
    views.values[key] = folded.value.slice(0, NODE_ITEMS_LIMIT);
    omitted[key] = folded.value.length - NODE_ITEMS_LIMIT;
  }
  return { ...views, omitted };
}

/**
 * A chat's computed story state, for the web: the values every key reads as right now, which stored turns still
 * count, and what each turn wrote. Read-only: it is the same fold the next turn starts from.
 */
export async function sessionStateView(context: AppContext, sessionId: string): Promise<View> {
  const session = await requireEntity(context.sessions, sessionId, 'Session');
  const { definitions, story } = await loadStoryState(context.stateDefinitions, session);
  const workflow = await context.workflows.get(session.workflowId);
  // Names only for nodes the chat's workflow still has; a deleted node's writes keep their data, not a name.
  const nodeLabel = (nodeId: string) =>
    workflow?.nodes.some((node) => node.id === nodeId)
      ? nodeDisplayName(workflow.nodes, (type) => registry.get(type)?.label ?? type, nodeId)
      : undefined;
  const names = new Map(definitions.map((definition) => [definition.id, definition.name]));
  const view = (write: StateWrite) => {
    const definitionName = write.target.kind === 'definition' ? names.get(write.target.definitionId) : undefined;
    const label = nodeLabel(write.nodeId);
    const preview = previewWrite(write);
    return {
      write: preview.write,
      ...(preview.truncated && { truncated: true }),
      ...(definitionName !== undefined && { definitionName }),
      ...(label !== undefined && { nodeLabel: label }),
    };
  };
  return {
    turn: story.turn,
    definitions: story.definitions.map((folded) => ({
      definitionId: folded.definitionId,
      name: folded.name,
      ...keyViews(folded.keys),
      warnings: folded.warnings,
    })),
    nodes: story.nodes.map((folded) => {
      const label = nodeLabel(folded.nodeId);
      return { nodeId: folded.nodeId, ...(label !== undefined && { label }), ...nodeKeyViews(folded.keys) };
    }),
    turns: story.turns.map(({ entry, turn }) => ({
      executionId: entry.executionId,
      at: entry.at,
      completed: entry.completed,
      replies: entry.replies,
      turnNumber: turn,
      writes: entry.writes.map(view),
    })),
  };
}
